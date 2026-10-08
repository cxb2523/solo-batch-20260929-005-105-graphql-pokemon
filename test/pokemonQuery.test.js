'use strict';

// 验收测试：`node --test test/pokemonQuery.test.js`
// 测试文件为纯 CJS 入口，先注册 babel，再在进程内启动 Koa 服务。
require('babel-polyfill');
require('babel-register');

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/app').default || require('../src/app');
const pokemonService = require('../src/service/Pokemon');

const QUERY = `
  query ($name: String, $type: PokemonKind, $evolutionStage: Int, $limit: Int, $offset: Int) {
    pokemons { id name }
    pokemonsV2(name: $name, type: $type, evolutionStage: $evolutionStage, limit: $limit, offset: $offset) {
      total
      hasNextPage
      items { number name types }
    }
  }
`;

const LEGACY_QUERY = `query { pokemons { id number name } }`;

let server;
let baseUrl;

function gqlRequest(body) {
  return fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(resp => resp.json());
}

function page(variables) {
  return gqlRequest({ query: QUERY, variables }).then(payload => {
    if (payload.errors) {
      throw new Error(payload.errors.map(error => error.message).join('\n'));
    }
    return payload.data.pokemonsV2;
  });
}

test.before(async () => {
  server = http.createServer(app.callback());
  await new Promise(resolve => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('老客户端无参调用仍返回全量数组，字段形状不变；first 语义保留', async () => {
  const payload = await gqlRequest({ query: LEGACY_QUERY });
  assert.equal(payload.errors, undefined);
  assert.ok(Array.isArray(payload.data.pokemons));
  assert.equal(payload.data.pokemons.length, 151);
  assert.equal(payload.data.pokemons[0].number, '001');
  assert.equal(payload.data.pokemons[0].name, 'Bulbasaur');
  assert.ok(payload.data.pokemons[0].id);

  const limited = await gqlRequest({
    query: 'query { pokemons(first: 5) { number } }',
  });
  assert.equal(limited.data.pokemons.length, 5);
  assert.deepEqual(
    limited.data.pokemons.map(item => item.number),
    ['001', '002', '003', '004', '005']
  );
});

test('二十个并发查询只触发一次索引构建（模块级单飞）', async () => {
  // 上一个用例可能已触发懒构建；以当前值为基线，断言本波并发只再构建 0 次。
  const buildsBefore = pokemonService.__getIndexBuildCount();
  assert.ok(buildsBefore <= 1, '索引至懒触发前最多只会构建一次');

  const filters = [
    {},
    { name: 'a' },
    { name: 'CHAR' },
    { name: 'saur' },
    { type: 'FIRE' },
    { type: 'WATER' },
    { type: 'GRASS' },
    { type: 'PSYCHIC' },
    { type: 'DRAGON' },
    { evolutionStage: 1 },
    { evolutionStage: 2 },
    { evolutionStage: 3 },
    { name: 'a', type: 'GRASS' },
    { name: 'e', evolutionStage: 3 },
    { type: 'FIRE', evolutionStage: 1 },
    { limit: 1, offset: 0 },
    { limit: 50, offset: 50 },
    { limit: 100, offset: 100 },
    { limit: 7, offset: 149 },
    { name: 'mew' },
  ];

  const results = await Promise.all(
    filters.map(variables => page(variables))
  );

  assert.equal(
    pokemonService.__getIndexBuildCount(),
    Math.max(buildsBefore, 1),
    '20 个并发查询必须共享同一次索引构建'
  );
  results.forEach(result => {
    assert.equal(result.items.length <= 100, true);
    assert.equal(result.items.length <= result.total, true);
  });

  // 再来一波，索引快照冻结、不得重建。
  await Promise.all(filters.slice(0, 10).map(variables => page(variables)));
  assert.equal(pokemonService.__getIndexBuildCount(), 1);
});

test('total 为真实匹配数，items 长度与分页切片一致', async () => {
  const first = await page({ type: 'FIRE', limit: 7, offset: 0 });
  assert.equal(first.total, 12);
  assert.equal(first.items.length, 7);
  assert.equal(first.hasNextPage, true);

  const second = await page({ type: 'FIRE', limit: 7, offset: 7 });
  assert.equal(second.total, 12);
  assert.equal(second.items.length, 5);
  assert.equal(second.hasNextPage, false);

  const ids = [...first.items, ...second.items].map(item => item.number);
  // 升序、无重复无遗漏地覆盖全部命中
  assert.deepEqual(ids.map(Number), [...new Set(ids)].map(Number).sort((a, b) => a - b));
  assert.equal(ids.length, first.total);

  // 名字子串忽略大小写
  const byName = await page({ name: 'CHAR' });
  assert.equal(byName.total, 3);
  assert.deepEqual(
    byName.items.map(item => item.name),
    ['Charmander', 'Charmeleon', 'Charizard']
  );

  // 进化阶段：16 个中间形态
  const stage2 = await page({ evolutionStage: 2, limit: 100 });
  assert.equal(stage2.total, 16);
  assert.equal(stage2.items.length, 16);
});

test('offset 越界：items 为空但 total 仍是真实匹配数；边界页正确', async () => {
  const overflow = await page({ limit: 100, offset: 999 });
  assert.equal(overflow.total, 151);
  assert.deepEqual(overflow.items, []);
  assert.equal(overflow.hasNextPage, false);

  const atTotal = await page({ limit: 100, offset: 151 });
  assert.equal(atTotal.total, 151);
  assert.deepEqual(atTotal.items, []);

  const lastOne = await page({ limit: 100, offset: 150 });
  assert.equal(lastOne.total, 151);
  assert.equal(lastOne.items.length, 1);
  assert.equal(lastOne.items[0].name, 'Mew');
  assert.equal(lastOne.hasNextPage, false);

  const secondFullPage = await page({ limit: 100, offset: 100 });
  assert.equal(secondFullPage.total, 151);
  assert.equal(secondFullPage.items.length, 51);
  assert.equal(secondFullPage.hasNextPage, false);
});

test('非法参数以 GraphQL 错误返回，不返回数据', async () => {
  const badCases = [
    { variables: { limit: 101 } },
    { variables: { limit: 0 } },
    { variables: { limit: -1 } },
    { variables: { offset: -1 } },
    { variables: { evolutionStage: 0 } },
    { variables: { evolutionStage: 4 } },
  ];

  for (const { variables } of badCases) {
    const payload = await gqlRequest({ query: QUERY, variables });
    assert.ok(Array.isArray(payload.errors), `应报错: ${JSON.stringify(variables)}`);
    assert.equal(payload.errors.length > 0, true);
    assert.equal(payload.data, null);
  }

  // 非法枚举值属于 GraphQL 参数校验错误
  const badEnum = await gqlRequest({
    query: QUERY,
    variables: { type: 'NOT_A_KIND' },
  });
  assert.ok(badEnum.errors);
  assert.equal(badEnum.errors.length > 0, true);
});


