import {
  GraphQLObjectType,
  GraphQLInt,
  GraphQLString,
  GraphQLList,
  GraphQLNonNull,
} from 'graphql';
import {
  fromGlobalId,
} from 'graphql-relay';

import PokemonType from './PokemonType';
import PokemonPageType, { PokemonKindType } from './PokemonPageType';

import {
  getPokemons,
  getPokemonById,
  getPokemonByName,
  queryPokemons,
  POKEMON_QUERY_LIMIT_MAX,
} from '../service/Pokemon';


const QueryType = new GraphQLObjectType({
  name: 'Query',
  description: 'Query any Pokémon by number or name',
  fields: () => ({
    query: {
      type: QueryType,
      resolve: (...args) => args,
    },
    // 老查询保持向后兼容：
    // - 返回类型依旧是 [Pokemon]（类型未改动）；
    // - first 由 NonNull 放宽为可选，老客户端无参调用时拿到全量数组、字段形状不变；
    // - 新客户端应改用支持筛选/分页的 pokemonsV2。
    pokemons: {
      type: new GraphQLList(PokemonType),
      args: {
        first: {
          type: GraphQLInt,
        },
      },
      resolve: async (obj, args) => await getPokemons(args),
    },
    pokemonsV2: {
      type: new GraphQLNonNull(PokemonPageType),
      description:
        `Filter and paginate Pokémon. Results are stably sorted by id ascending; `
        + `limit is capped at ${POKEMON_QUERY_LIMIT_MAX}.`,
      args: {
        name: {
          type: GraphQLString,
          description: 'Case-insensitive substring matched against the Pokémon name',
        },
        type: {
          type: PokemonKindType,
          description: 'Elemental kind the Pokémon must have',
        },
        evolutionStage: {
          type: GraphQLInt,
          description: '1 = base, 2 = intermediate, 3 = final form',
        },
        limit: {
          type: GraphQLInt,
          description: `Page size, 1..${POKEMON_QUERY_LIMIT_MAX} (default ${POKEMON_QUERY_LIMIT_MAX})`,
        },
        offset: {
          type: GraphQLInt,
          description: 'Zero-based offset into the filtered, id-ascending result list',
        },
      },
      resolve: async (obj, args) => await queryPokemons(args),
    },
    pokemon: {
      type: PokemonType,
      args: {
        id: {
          type: GraphQLString,
        },
        name: {
          type: GraphQLString,
        },
      },
      resolve: async (obj, { id, name }) => {
        if (id) {
          return await getPokemonById(fromGlobalId(id).id);
        }

        if (name) {
          return await getPokemonByName(name);
        }

        throw new Error(
          'You need to specify either the ID or name of the Pokémon'
        );
      },
    },
  }),
});

export default QueryType;
