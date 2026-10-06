const {
  GraphQLObjectType,
  GraphQLInt,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
} = require('graphql');

const PokemonType = require('./PokemonType');

const PokemonsPageType = new GraphQLObjectType({
  name: 'PokemonsPage',
  description: 'A filtered, paginated page of Pokémon',
  fields: () => ({
    items: {
      type: new GraphQLNonNull(new GraphQLList(PokemonType)),
      description: 'Pokémon matching the filters for the current page, ordered by id ascending',
      resolve: page => page.items,
    },
    total: {
      type: new GraphQLNonNull(GraphQLInt),
      description: 'Total number of Pokémon matching the filters (ignoring limit/offset)',
      resolve: page => page.total,
    },
    hasNextPage: {
      type: new GraphQLNonNull(GraphQLBoolean),
      description: 'Whether another page of matching Pokémon exists after this one',
      resolve: page => page.hasNextPage,
    },
  }),
});

module.exports = PokemonsPageType;
