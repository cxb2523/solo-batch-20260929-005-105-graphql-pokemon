import {
  GraphQLEnumType,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
} from 'graphql';

import PokemonType from './PokemonType';

// 宝可梦属性类型。数据集（Gen 1）共出现 17 种；沿用官方 18 种枚举命名，
// 没有 Dark 系宝可梦时对应筛选结果为空。
export const PokemonKindType = new GraphQLEnumType({
  name: 'PokemonKind',
  description: 'The elemental kind(s) a Pokémon can have',
  values: {
    NORMAL: { value: 'Normal' },
    FIRE: { value: 'Fire' },
    WATER: { value: 'Water' },
    ELECTRIC: { value: 'Electric' },
    GRASS: { value: 'Grass' },
    ICE: { value: 'Ice' },
    FIGHTING: { value: 'Fighting' },
    POISON: { value: 'Poison' },
    GROUND: { value: 'Ground' },
    FLYING: { value: 'Flying' },
    PSYCHIC: { value: 'Psychic' },
    BUG: { value: 'Bug' },
    ROCK: { value: 'Rock' },
    GHOST: { value: 'Ghost' },
    DRAGON: { value: 'Dragon' },
    DARK: { value: 'Dark' },
    STEEL: { value: 'Steel' },
    FAIRY: { value: 'Fairy' },
  },
});

const PokemonPageType = new GraphQLObjectType({
  name: 'PokemonPage',
  description: 'A stable, id-ascending page of filtered Pokémon',
  fields: () => ({
    items: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(PokemonType))),
      description: 'Pokémon on the current page, ordered by id ascending',
      resolve: obj => obj.items,
    },
    total: {
      type: new GraphQLNonNull(GraphQLInt),
      description: 'Total number of Pokémon matching the filters',
      resolve: obj => obj.total,
    },
    hasNextPage: {
      type: new GraphQLNonNull(GraphQLBoolean),
      description: 'Whether a subsequent page with the same filters exists',
      resolve: obj => obj.hasNextPage,
    },
  }),
});

export default PokemonPageType;
