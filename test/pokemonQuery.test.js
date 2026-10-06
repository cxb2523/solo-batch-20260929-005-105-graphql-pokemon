const test = require('node:test');
const assert = require('node:assert');

const app = require('../src/app');
const pokemonService = require('../src/service/Pokemon');

const PAGE_QUERY = `
  query PokemonsPage($name: String, $type: String, $evolutionStage: Int, $limit: Int, $offset: Int) {
    pokemonsPage(name: $name, type: $type, evolutionStage: $evolutionStage, limit: $limit, offset: $offset) {
      total
      hasNextPage
      items { id number name types }
    }
  }
`;

let server;
let endpoint;

function gql(query, variables) {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: variables || null }),
  }).then(response => response.json());
}

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });

  const address = server.address();
  endpoint = `http://127.0.0.1:${address.port}/graphql`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// Must run first: the index is lazily created by the very first request and
// must be created exactly once even under a 20-way concurrent burst.
test('builds the search index exactly once under twenty concurrent queries', async () => {
  assert.strictEqual(
    pokemonService.getIndexBuildCount(),
    0,
    'index must not be built at module load (lazy single-flight)'
  );

  const requests = Array.from({ length: 20 }, (_, index) =>
    gql(PAGE_QUERY, {
      limit: 5,
      offset: index * 5,
    })
  );

  const results = await Promise.all(requests);

  results.forEach((result, index) => {
    assert.ifError(result.errors, `request ${index} should not fail`);
    assert.strictEqual(result.data.pokemonsPage.total, 151);
    assert.strictEqual(result.data.pokemonsPage.items.length, 5);
  });

  assert.strictEqual(
    pokemonService.getIndexBuildCount(),
    1,
    'all concurrent requests must share one single-flight index build'
  );
});

test('returns total and items length for a name substring filter (case-insensitive)', async () => {
  const result = await gql(PAGE_QUERY, { name: 'CHAR', limit: 100, offset: 0 });

  assert.ifError(result.errors);

  const { items, total, hasNextPage } = result.data.pokemonsPage;
  assert.strictEqual(total, items.length);
  assert.strictEqual(total, 3);
  assert.strictEqual(hasNextPage, false);
  items.forEach((pokemon) => {
    assert.ok(pokemon.name.toLowerCase().includes('char'));
  });
});

test('filters by type and evolution stage together', async () => {
  const stageOne = await gql(PAGE_QUERY, { type: 'fire', evolutionStage: 1 });
  assert.ifError(stageOne.errors);
  assert.strictEqual(stageOne.data.pokemonsPage.total, 6);
  stageOne.data.pokemonsPage.items.forEach((pokemon) => {
    assert.ok(pokemon.types.map(t => t.toLowerCase()).includes('fire'));
  });

  const stageThree = await gql(PAGE_QUERY, { type: 'Fire', evolutionStage: 3 });
  assert.ifError(stageThree.errors);
  assert.strictEqual(stageThree.data.pokemonsPage.total, 1);
  assert.strictEqual(stageThree.data.pokemonsPage.items[0].name, 'Charizard');
});

test('pages stably by ascending id without repeating or skipping items', async () => {
  const seen = [];
  let total = null;
  let hasNextPage = true;
  let offset = 0;
  const limit = 7;

  while (hasNextPage) {
    const result = await gql(PAGE_QUERY, { limit, offset });
    assert.ifError(result.errors);

    const page = result.data.pokemonsPage;
    total = page.total;
    hasNextPage = page.hasNextPage;

    page.items.forEach((pokemon) => {
      assert.ok(!seen.includes(pokemon.id), `id ${pokemon.id} repeated across pages`);
      seen.push(pokemon.id);
    });

    offset += limit;
  }

  assert.strictEqual(seen.length, total);

  const numericIds = seen.map((globalId) => {
    const decoded = Buffer.from(globalId, 'base64').toString('utf8');
    return Number(decoded.slice(decoded.indexOf(':') + 1));
  });
  numericIds.forEach((id, index) => {
    if (index > 0) {
      assert.ok(id > numericIds[index - 1], 'ids must be strictly ascending across pages');
    }
  });
});

test('offset beyond the matched range yields empty items but a real total', async () => {
  const totalResult = await gql(PAGE_QUERY, { name: 'char', limit: 100, offset: 0 });
  const total = totalResult.data.pokemonsPage.total;
  assert.strictEqual(total, 3);

  const beyond = await gql(PAGE_QUERY, { name: 'char', limit: 100, offset: total });
  assert.ifError(beyond.errors);
  assert.strictEqual(beyond.data.pokemonsPage.total, total);
  assert.deepStrictEqual(beyond.data.pokemonsPage.items, []);
  assert.strictEqual(beyond.data.pokemonsPage.hasNextPage, false);

  const farBeyond = await gql(PAGE_QUERY, { name: 'char', limit: 100, offset: 9999 });
  assert.ifError(farBeyond.errors);
  assert.strictEqual(farBeyond.data.pokemonsPage.total, total);
  assert.deepStrictEqual(farBeyond.data.pokemonsPage.items, []);

  const lastItem = await gql(PAGE_QUERY, { name: 'char', limit: 100, offset: total - 1 });
  assert.ifError(lastItem.errors);
  assert.strictEqual(lastItem.data.pokemonsPage.items.length, 1);
  assert.strictEqual(lastItem.data.pokemonsPage.hasNextPage, false);

  const unfilteredBeyond = await gql(PAGE_QUERY, { limit: 100, offset: 151 });
  assert.ifError(unfilteredBeyond.errors);
  assert.strictEqual(unfilteredBeyond.data.pokemonsPage.total, 151);
  assert.deepStrictEqual(unfilteredBeyond.data.pokemonsPage.items, []);
});

test('respects the limit cap of 100 and reports hasNextPage correctly', async () => {
  const result = await gql(PAGE_QUERY, { limit: 100, offset: 0 });
  assert.ifError(result.errors);
  assert.strictEqual(result.data.pokemonsPage.items.length, 100);
  assert.strictEqual(result.data.pokemonsPage.total, 151);
  assert.strictEqual(result.data.pokemonsPage.hasNextPage, true);

  const nextPage = await gql(PAGE_QUERY, { limit: 100, offset: 100 });
  assert.ifError(nextPage.errors);
  assert.strictEqual(nextPage.data.pokemonsPage.items.length, 51);
  assert.strictEqual(nextPage.data.pokemonsPage.hasNextPage, false);
});

test('rejects illegal arguments with GraphQL errors', async () => {
  const overLimit = await gql(PAGE_QUERY, { limit: 101 });
  assert.ok(Array.isArray(overLimit.errors));
  assert.match(overLimit.errors[0].message, /limit/i);

  const negativeLimit = await gql(PAGE_QUERY, { limit: -1 });
  assert.ok(Array.isArray(negativeLimit.errors));

  const negativeOffset = await gql(PAGE_QUERY, { offset: -5 });
  assert.ok(Array.isArray(negativeOffset.errors));

  const badStage = await gql(PAGE_QUERY, { evolutionStage: 4 });
  assert.ok(Array.isArray(badStage.errors));
  assert.match(badStage.errors[0].message, /evolutionStage/i);

  const nonIntegerLimit = await gql(PAGE_QUERY, { limit: 'ten' });
  assert.ok(Array.isArray(nonIntegerLimit.errors));
});

test('legacy pokemons query without arguments keeps returning the full array', async () => {
  const result = await gql('{ pokemons { id number name types } }');
  assert.ifError(result.errors);
  assert.strictEqual(result.data.pokemons.length, 151);

  const first = result.data.pokemons[0];
  assert.ok(first.id);
  assert.ok(first.number);
  assert.ok(first.name);
  assert.ok(Array.isArray(first.types));

  const limited = await gql('{ pokemons(first: 3) { id name } }');
  assert.ifError(limited.errors);
  assert.strictEqual(limited.data.pokemons.length, 3);
});

