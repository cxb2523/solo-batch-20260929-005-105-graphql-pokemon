import pokemonsData from '../pokemons/pokemons.json';

// =============================================================================
// 模块级只读索引（单飞 / in-flight dedupe）
// -----------------------------------------------------------------------------
// 首个请求到达时构建一次，之后所有并发请求 await 同一个 promise：构建只会发生
// 一次，任何请求都不会拿到"半建"状态。索引构建完成后立即 Object.freeze 冻结，
// 快照终身复用、永不重建。
//
// 这笔账是用内存换时间：
//   - 若每个请求都在 151 条原始数据上惰性 filter（名字 includes + 类型遍历 +
//     进化链反查 + 排序），单次查询是 O(n)，且每次翻页都要重算一遍，QPS 越高
//     浪费越明显；
//   - 这里一次性付出 O(n) 构建成本，额外常驻 id 有序表、id -> 实体映射与类型 /
//     阶段两份倒排的内存；之后类型、阶段筛选是对有序 id 列表求交集（O(a+b)），
//     名字子串在有序结果上做一次不区分大小写的线性扫描，翻页切片为 O(limit)，
//     且同一请求只过滤一遍 —— 不再逐请求、逐页重复全量惰性筛。
//   数据集只读且小，快照冻结后无需任何加锁与失效逻辑。
// =============================================================================

const EVOLUTION_STAGES = Object.freeze({
  BASE: 1,         // 没有任何宝可梦进化成它（进化链起点）
  INTERMEDIATE: 2, // 既被进化而来、又能继续进化
  FINAL: 3,        // 被进化而来、自身不再进化
});

let indexPromise = null;
let buildCount = 0;

function normalizeId(id) {
  return parseInt(id, 10);
}

function buildIndex() {
  buildCount += 1;

  // 分页必须按 id 升序稳定排序：原始 JSON 本身有序，这里仍显式排序，避免依赖
  // 数据文件的排列顺序。
  const byIdAscending = pokemonsData
    .slice()
    .sort((left, right) => normalizeId(left.id) - normalizeId(right.id));

  const byId = new Map();
  const orderedIds = [];
  const incomingIds = new Set();
  const typeToIds = new Map();
  const stageToIds = new Map()
    .set(EVOLUTION_STAGES.BASE, [])
    .set(EVOLUTION_STAGES.INTERMEDIATE, [])
    .set(EVOLUTION_STAGES.FINAL, []);

  byIdAscending.forEach((pokemon) => {
    byId.set(String(pokemon.id), pokemon);
    orderedIds.push(pokemon.id);
  });

  // 第一遍：收集"谁是被进化目标"，用于判定进化阶段。
  byIdAscending.forEach((pokemon) => {
    (pokemon.evolutions || []).forEach((evolution) => {
      incomingIds.add(String(evolution.id).padStart(3, "0"));
    });
  });

  // 第二遍：建立类型倒排与阶段倒排（id 天然保持升序）。
  byIdAscending.forEach((pokemon) => {
    const hasIncoming = incomingIds.has(String(pokemon.id));
    const hasOutgoing = (pokemon.evolutions || []).length > 0;
    const stage = !hasIncoming
      ? EVOLUTION_STAGES.BASE
      : (hasOutgoing
        ? EVOLUTION_STAGES.INTERMEDIATE
        : EVOLUTION_STAGES.FINAL);

    stageToIds.get(stage).push(pokemon.id);

    (pokemon.types || []).forEach((type) => {
      const key = type.toLowerCase();
      if (!typeToIds.has(key)) {
        typeToIds.set(key, []);
      }
      typeToIds.get(key).push(pokemon.id);
    });
  });

  const snapshot = Object.freeze({
    orderedIds: Object.freeze(orderedIds),
    byId,
    typeToIds,
    stageToIds,
  });

  return snapshot;
}

// 单飞入口：并发调用拿到的是同一个 promise；构建完成后同一快照永不重建。
function getIndex() {
  if (!indexPromise) {
    indexPromise = new Promise((resolve) => resolve(buildIndex()));
  }
  return indexPromise;
}

// 仅供测试断言"索引只构建一次"，不属于业务 API。
export function __getIndexBuildCount() {
  return buildCount;
}

// 两个有序 id 列表求交集（按数字 id 升序）。任一为空结果即为空。
function intersectOrderedIds(left, right) {
  if (left.length === 0 || right.length === 0) {
    return [];
  }
  const intersection = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftId = normalizeId(left[leftIndex]);
    const rightId = normalizeId(right[rightIndex]);
    if (leftId === rightId) {
      intersection.push(left[leftIndex]);
      leftIndex += 1;
      rightIndex += 1;
    } else if (leftId < rightId) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return intersection;
}

async function matchIds({ name, type, evolutionStage } = {}) {
  const index = await getIndex();

  let matchedIds = index.orderedIds;

  if (typeof name === 'string' && name.length > 0) {
    const needle = name.toLowerCase();
    matchedIds = matchedIds.filter((id) =>
      index.byId.get(String(id)).name.toLowerCase().indexOf(needle) !== -1
    );
  }

  if (typeof type === 'string' && type.length > 0) {
    const typeIds = index.typeToIds.get(type.toLowerCase()) || [];
    matchedIds = intersectOrderedIds(matchedIds, typeIds);
  }

  if (typeof evolutionStage === 'number') {
    const stageIds = index.stageToIds.get(evolutionStage) || [];
    matchedIds = intersectOrderedIds(matchedIds, stageIds);
  }

  return matchedIds;
}

export const POKEMON_QUERY_LIMIT_MAX = 100;
export const POKEMON_QUERY_LIMIT_DEFAULT = 100;

export class PokemonQueryError extends Error {}

// 兼容老客户端的 pokemons 查询：
// - 无参调用（args.first 为 undefined）时行为与历史一致 —— 返回全量数组，
//   字段形状（[Pokemon!]! 之外的 [Pokemon] 列表）不变；
// - 保留旧的 first 入参语义（取前 first 条，按 id 升序）。
export async function getPokemons(args = {}) {
  const { first } = args;

  if (first === undefined || first === null) {
    return pokemonsData.slice();
  }

  if (!Number.isInteger(first) || first < 0) {
    throw new PokemonQueryError(
      `Argument "first" must be a non-negative integer, got: ${first}`
    );
  }

  const index = await getIndex();

  return index.orderedIds
    .slice(0, first)
    .map(id => index.byId.get(String(id)));
}

// 新查询 pokemonsV2：筛选 + 分页。
// 返回 { items, total, hasNextPage }：
// - total 恒为当前筛选条件下的真实命中总数（offset 越界时 items 为空、total 不变）；
// - items 按 id 升序切片，保证翻页不重不漏；
// - limit 上限 100；非法参数抛 PokemonQueryError（由 GraphQL 层转成 GraphQL 错误）。
export async function queryPokemons(args = {}) {
  const {
    name,
    type,
    evolutionStage,
    limit = POKEMON_QUERY_LIMIT_DEFAULT,
    offset = 0,
  } = args;

  if (!Number.isInteger(limit) || limit < 1) {
    throw new PokemonQueryError(
      `Argument "limit" must be an integer between 1 and ${POKEMON_QUERY_LIMIT_MAX}, got: ${limit}`
    );
  }
  if (limit > POKEMON_QUERY_LIMIT_MAX) {
    throw new PokemonQueryError(
      `Argument "limit" must not exceed ${POKEMON_QUERY_LIMIT_MAX}, got: ${limit}`
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new PokemonQueryError(
      `Argument "offset" must be a non-negative integer, got: ${offset}`
    );
  }
  if (
    evolutionStage !== undefined
    && evolutionStage !== null
    && (
      !Number.isInteger(evolutionStage)
      || evolutionStage < EVOLUTION_STAGES.BASE
      || evolutionStage > EVOLUTION_STAGES.FINAL
    )
  ) {
    throw new PokemonQueryError(
      `Argument "evolutionStage" must be one of 1 (base), 2 (intermediate) or 3 (final), got: ${evolutionStage}`
    );
  }
  if (name !== undefined && name !== null && typeof name !== 'string') {
    throw new PokemonQueryError('Argument "name" must be a string');
  }
  if (type !== undefined && type !== null && typeof type !== 'string') {
    throw new PokemonQueryError('Argument "type" must be a string');
  }

  const index = await getIndex();
  const matchedIds = await matchIds({
    name,
    type,
    evolutionStage: evolutionStage === undefined || evolutionStage === null
      ? undefined
      : evolutionStage,
  });

  const total = matchedIds.length;
  const pageIds = matchedIds.slice(offset, offset + limit);
  const items = pageIds.map(id => index.byId.get(String(id)));

  return {
    items,
    total,
    hasNextPage: offset + items.length < total,
  };
}

export async function getPokemonById(pokemonId) {
  const pokemon = pokemonsData.filter(({ id }) =>
    parseInt(id, 10) === parseInt(pokemonId, 10)
  );

  return pokemon[0] || null;
}

export async function getPokemonByName(pokemonNameSearch) {
  const pokemonName = pokemonNameSearch.toLowerCase().trim();

  const pokemon = pokemonsData.filter(({ name }) =>
    name.toLowerCase() === pokemonName
  );

  if (pokemon) {
    return pokemon[0];
  }

  return pokemon[0] || null;
}

export async function getPokemonByEvolutions(evolutions) {
  if (!evolutions) {
    return null;
  }

  const pokemonNames = evolutions.map(evolution =>
    evolution.name.toLowerCase().trim()
  );

  const searchedPokemons = pokemonsData.filter(({ name }) =>
    pokemonNames.indexOf(name.toLowerCase()) !== -1
  );

  return searchedPokemons || null;
}


