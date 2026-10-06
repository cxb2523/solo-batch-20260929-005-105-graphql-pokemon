const pokemons = require('../pokemons/pokemons.json');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Search index: module-level single-flight ("stampede control") snapshot.
//
// The index is built lazily on the first query that needs it. If several
// requests arrive while the index is still being built they ALL wait on the
// SAME promise (in-flight deduplication) instead of every request building
// its own copy. Once built the snapshot is frozen and reused forever: the
// backing data is a read-only JSON shipped with the app, so it never changes
// at runtime and a rebuilt index could never produce different results.
//
// This is the deliberate memory-for-time trade-off of the feature:
//   * Building once and keeping the sorted array / lookup maps in memory costs
//     O(n) memory for the whole lifetime of the process.
//   * In exchange each query is O(n) only for the filter scan itself and
//     O(1) for id/name lookups, whereas a fully lazy implementation that
//     sorted and mapped the raw data on every request would degrade those
//     O(1) lookups into O(n) scans and re-pay the preprocessing cost (sort,
//     lowercase, stage computation) per request under concurrency.
// ---------------------------------------------------------------------------
let indexPromise = null;
let indexBuildCount = 0;

function computeEvolutionStages(sorted) {
  // A Pokémon is a base form (stage 1) unless it appears as an evolution
  // target of some other Pokémon; targets get resolved by propagation below.
  const isEvolutionTarget = new Set();

  sorted.forEach((pokemon) => {
    (pokemon.evolutions || []).forEach((evolution) => {
      isEvolutionTarget.add(evolution.name);
    });
  });

  const stages = {};

  sorted.forEach((pokemon) => {
    stages[pokemon.name] = isEvolutionTarget.has(pokemon.name) ? null : 1;
  });

  // Stage of a target is one greater than the stage it evolves from. Iterate
  // until nothing changes so chains of any length resolve in any data order.
  let changed = true;

  while (changed) {
    changed = false;

    sorted.forEach((pokemon) => {
      const fromStage = stages[pokemon.name];

      if (!fromStage) {
        return;
      }

      (pokemon.evolutions || []).forEach((evolution) => {
        const currentStage = stages[evolution.name];

        if (currentStage === null || currentStage < fromStage + 1) {
          stages[evolution.name] = fromStage + 1;
          changed = true;
        }
      });
    });
  }

  return stages;
}

function buildIndex() {
  indexBuildCount += 1;

  // Stable order: numeric id ascending. The shipped JSON is already id-sorted
  // but sorting here makes pagination correctness independent of file order.
  const sorted = pokemons
    .slice()
    .sort((first, second) => parseInt(first.id, 10) - parseInt(second.id, 10));

  const byId = new Map();
  const byName = {};

  sorted.forEach((pokemon) => {
    byId.set(parseInt(pokemon.id, 10), pokemon);
    byName[pokemon.name.toLowerCase()] = pokemon;
  });

  const evolutionStages = computeEvolutionStages(sorted);

  // Frozen, pre-normalised snapshot: lowercased fields and evolution stages
  // are computed once here rather than on every request.
  const enriched = sorted.map((pokemon) =>
    Object.freeze(Object.assign({}, pokemon, {
      evolutionStage: evolutionStages[pokemon.name] || null,
      nameLower: pokemon.name.toLowerCase(),
      typesLower: (pokemon.types || []).map(type => type.toLowerCase()),
    }))
  );

  return Object.freeze({
    sorted: Object.freeze(enriched),
    byId,
    byName,
  });
}

function getIndex() {
  // Single-flight: the first request kicks off the build, every concurrent
  // request awaits the very same promise; the frozen snapshot is never rebuilt.
  if (indexPromise === null) {
    indexPromise = Promise.resolve().then(buildIndex);
  }

  return indexPromise;
}

// Exposed for tests: number of times the index snapshot was actually built.
function getIndexBuildCount() {
  return indexBuildCount;
}

function validatePagination(args) {
  const limit = args.limit === undefined || args.limit === null
    ? DEFAULT_LIMIT
    : args.limit;
  const offset = args.offset === undefined || args.offset === null
    ? 0
    : args.offset;

  if (typeof limit !== 'number' || Number.isNaN(limit)) {
    throw new Error('Argument "limit" must be an integer.');
  }

  if (typeof offset !== 'number' || Number.isNaN(offset)) {
    throw new Error('Argument "offset" must be an integer.');
  }

  if (limit < 0) {
    throw new Error('Argument "limit" must not be a negative number.');
  }

  if (limit > MAX_LIMIT) {
    throw new Error(`Argument "limit" must not be greater than ${MAX_LIMIT}.`);
  }

  if (offset < 0) {
    throw new Error('Argument "offset" must not be a negative number.');
  }

  if (args.evolutionStage !== undefined && args.evolutionStage !== null) {
    if (args.evolutionStage < 1 || args.evolutionStage > 3) {
      throw new Error(
        'Argument "evolutionStage" must be one of: 1 (base form), 2 (first evolution) or 3 (second evolution).'
      );
    }
  }

  return { limit, offset };
}

async function queryPokemons(rawArgs) {
  const args = rawArgs || {};
  const { limit, offset } = validatePagination(args);

  const index = await getIndex();

  const nameNeedle = typeof args.name === 'string'
    ? args.name.toLowerCase().trim()
    : null;
  const typeNeedle = typeof args.type === 'string'
    ? args.type.toLowerCase().trim()
    : null;
  const stageNeedle = args.evolutionStage === undefined || args.evolutionStage === null
    ? null
    : args.evolutionStage;

  // The snapshot is already id-ascending, so a linear filter scan yields a
  // stably ordered result: paging with offset/limit can never repeat or skip.
  const matches = index.sorted.filter((pokemon) => {
    if (nameNeedle && pokemon.nameLower.indexOf(nameNeedle) === -1) {
      return false;
    }

    if (typeNeedle && pokemon.typesLower.indexOf(typeNeedle) === -1) {
      return false;
    }

    if (stageNeedle !== null && pokemon.evolutionStage !== stageNeedle) {
      return false;
    }

    return true;
  });

  const total = matches.length;
  const items = matches.slice(offset, offset + limit);

  return {
    items,
    total,
    hasNextPage: offset + items.length < total,
  };
}

async function getPokemons(args) {
  // Legacy field: no arguments (or no "first") returns the full array with
  // the exact same shape as before; the return type is untouched.
  if (!args || args.first === undefined || args.first === null) {
    return pokemons;
  }

  return pokemons.slice(0, args.first);
}

async function getPokemonById(pokemonId) {
  const index = await getIndex();

  return index.byId.get(parseInt(pokemonId, 10)) || null;
}

async function getPokemonByName(pokemonNameSearch) {
  const index = await getIndex();

  const pokemonName = pokemonNameSearch.toLowerCase().trim();

  return index.byName[pokemonName] || null;
}

async function getPokemonByEvolutions(evolutions) {
  if (!evolutions) {
    return null;
  }

  const pokemonNames = evolutions.map(evolution =>
    evolution.name.toLowerCase().trim()
  );

  const searchedPokemons = pokemons.filter(({ name }) =>
    pokemonNames.indexOf(name.toLowerCase()) !== -1
  );

  return searchedPokemons || null;
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  getIndex,
  getIndexBuildCount,
  queryPokemons,
  getPokemons,
  getPokemonById,
  getPokemonByName,
  getPokemonByEvolutions,
};
