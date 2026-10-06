#!/usr/bin/env node
/**
 * Regenerates schemas/schema.json (introspection result) and
 * schemas/schema.graphql (SDL). Running this script repeatedly must not
 * produce any drift.
 */

const fs = require('fs');
const path = require('path');
const { graphql } = require('graphql');
const { introspectionQuery, printSchema } = require('graphql/utilities');

const GraphQLSchema = require('../src/schema');

async function generateSchema(schema, relativePath) {
  const result = await graphql(schema, introspectionQuery);

  if (result.errors) {
    console.error(
      'ERROR introspecting schema: ',
      JSON.stringify(result.errors, null, 2)
    );
    process.exit(1);
  } else {
    fs.writeFileSync(
      path.join(__dirname, `${relativePath}/schema.json`),
      JSON.stringify(result, null, 2)
    );

    fs.writeFileSync(
      path.join(__dirname, `${relativePath}/schema.graphql`),
      printSchema(schema)
    );
  }
}

(async () => {
  await generateSchema(GraphQLSchema, '../schemas');

  process.exit(0);
})();
