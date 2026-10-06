const {
  GraphQLObjectType,
  GraphQLInt,
  GraphQLString,
  GraphQLList,
  GraphQLNonNull,
} = require('graphql');
const { fromGlobalId } = require('graphql-relay');

const PokemonType = require('./PokemonType');
const PokemonsPageType = require('./PokemonsPageType');

const {
  getPokemons,
  getPokemonById,
  getPokemonByName,
  queryPokemons,
} = require('../service/Pokemon');

const QueryType = new GraphQLObjectType({
  name: 'Query',
  description: 'Query any Pokémon by number or name',
  fields: () => ({
    query: {
      type: QueryType,
      resolve: (...args) => args,
    },
    pokemons: {
      // Return type is intentionally left untouched: a plain [Pokemon] list.
      type: new GraphQLList(PokemonType),
      args: {
        first: {
          type: GraphQLInt,
        },
      },
      // Called without arguments the field keeps returning the full array
      // with exactly the same shape as before, so old clients do not break.
      resolve: async (obj, args) => await getPokemons(args),
    },
    pokemonsPage: {
      type: new GraphQLNonNull(PokemonsPageType),
      description: 'Pokémon with filtering (name substring, type, evolution stage) and keyset-free offset pagination',
      args: {
        name: {
          type: GraphQLString,
          description: 'Case-insensitive substring matched against the Pokémon name',
        },
        type: {
          type: GraphQLString,
          description: 'Type the Pokémon must have (case-insensitive), e.g. "Fire"',
        },
        evolutionStage: {
          type: GraphQLInt,
          description: 'Evolution stage: 1 = base form, 2 = first evolution, 3 = second evolution',
        },
        limit: {
          type: GraphQLInt,
          description: 'Page size, maximum 100 (defaults to 20)',
        },
        offset: {
          type: GraphQLInt,
          description: 'Zero-based number of matching Pokémon to skip (defaults to 0)',
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

module.exports = QueryType;
