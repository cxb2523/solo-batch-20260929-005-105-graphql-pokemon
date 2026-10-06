const {
  GraphQLObjectType,
  GraphQLString,
} = require('graphql');

module.exports = new GraphQLObjectType({
  name: 'PokemonDimension',
  description: 'Represents a Pokémon\'s dimensions',
  fields: {
    minimum: {
      type: GraphQLString,
      description: 'The minimum value of this dimension',
      resolve: obj => obj.minimum,
    },
    maximum: {
      type: GraphQLString,
      description: 'The maximum value of this dimension',
      resolve: obj => obj.maximum,
    },
  },
});
