import { MutationPayloadQueryPlugin, NodePlugin, SchemaBuilder } from 'graphile-build'
import { makeWrapResolversPlugin } from 'graphile-utils'
import simplifyInflectorPlugin from '@graphile-contrib/pg-simplify-inflector'
import {
  GraphQLFieldConfigMap,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLInputFieldConfigMap,
  GraphQLNullableType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  isNonNullType,
  printSchema,
} from 'graphql'
import { GraphQLNonNull, isObjectType, isScalarType } from 'graphql/type/definition'
import { createPostGraphileSchema, makePluginHook } from 'postgraphile'
import { Pool } from 'pg'

/**
 * Postgraphile plugin which forces `NOT NULL` column to be generated
 * as Nullable field in graphql schema. Required for Primary Keys that
 * use auto-generated default values from sequences.
 */
const forceNullablePlugin = (builder: SchemaBuilder) => {
  const forceNullable = (fields: GraphQLInputFieldConfigMap, name: string): void => {
    if (fields[name]) {
      const field = fields[name]
      if (field.type instanceof GraphQLNonNull) {
        fields[name].type = field.type.ofType
      }
    }
  }
  builder.hook('GraphQLInputObjectType:fields', (fields) => {
    // Call for each NotNullable field that should be forced as Nullable
    forceNullable(fields, 'id')
    return fields
  })
}

const AWSID = GraphQLID
const NonNullAWSID = new GraphQLNonNull(AWSID)
const AWSFloat = GraphQLFloat
const NonNullFloat = new GraphQLNonNull(AWSFloat)
const AWSInt = GraphQLInt
const NonNullInt = new GraphQLNonNull(AWSInt)
const AWSString = GraphQLString
const NonNullString = new GraphQLNonNull(AWSString)
const AWSDate = new GraphQLScalarType({ name: 'AWSDate' })
const NonNullAWSDate = new GraphQLNonNull(AWSDate)
const AWSDateTime = new GraphQLScalarType({ name: 'AWSDateTime' })
const NonNullAWSDateTime = new GraphQLNonNull(AWSDateTime)
const AWSTime = new GraphQLScalarType({ name: 'AWSDateTime' })
const NonNullAWSTime = new GraphQLNonNull(AWSTime)
const AWSJson = new GraphQLScalarType({ name: 'AWSJSON' })
const NonNullAWSJson = new GraphQLNonNull(AWSJson)

/**
 * make sure we remove nested query from Query type
 * @param  {SchemaBuilder} builder
 */
const removeNestedQueryFieldPlugin = (builder: SchemaBuilder) => {
  builder.hook('GraphQLObjectType:fields', (fields) => {
    if (fields['query']) {
      delete fields['query']
    }
    if (fields['clientMutationId']) {
      delete fields['clientMutationId']
    }
    const names = Object.keys(fields)
    for (const name of names) {
      if (name.match(/deleted\w+NodeId/)) {
        delete fields[name]
      }
    }
    updateObjectTypes(fields)
    return fields
  })

  builder.hook('GraphQLInputObjectType:fields', (fields) => {
    if (fields['clientMutationId']) {
      delete fields['clientMutationId']
    }
    updateInputTypes(fields)
    return fields
  })
}
interface GenericField {
  type: GraphQLScalarType
}
interface NonNullGenericField {
  type: GraphQLNonNull<GraphQLNullableType>
}
const replacer = (field: GenericField) => {
  const things = [
    { name: 'UUID', check: (val: String) => val === 'UUID', update: () => AWSID },
    { name: 'Cursor', check: (val: String) => val === 'Cursor', update: () => AWSString },
    { name: 'Int', check: (val: String) => val === 'BigInt', update: () => AWSInt },
    { name: 'Float', check: (val: String) => val === 'BigFloat', update: () => AWSFloat },
    { name: 'AWSDate', check: (val: String) => val === 'Date', update: () => AWSDate },
    { name: 'AWSDateTime', check: (val: String) => val === 'Datetime', update: () => AWSDateTime },
    { name: 'AWSTime', check: (val: String) => val === 'Time', update: () => AWSTime },
    { name: 'AWSJson', check: (val: String) => val === 'JSON', update: () => AWSJson },
  ]
  things.forEach((rule) => {
    if (rule.check(field.type.name)) {
      field.type = rule.update()
    }
  })
}

const nonNullReplacer = (field: NonNullGenericField) => {
  const things = [
    { name: 'UUID', check: (val: String) => val === 'UUID!', update: () => NonNullAWSID },
    { name: 'Cursor', check: (val: String) => val === 'Cursor!', update: () => NonNullString },
    { name: 'Int', check: (val: String) => val === 'BigInt!', update: () => NonNullInt },
    { name: 'Float', check: (val: String) => val === 'BigFloat!', update: () => NonNullFloat },
    { name: 'NonNullAWSDate', check: (val: String) => val === 'Date!', update: () => NonNullAWSDate },
    { name: 'NonNullAWSDateTime', check: (val: String) => val === 'Datetime!', update: () => NonNullAWSDateTime },
    { name: 'AWSTime', check: (val: String) => val === 'Time!', update: () => NonNullAWSTime },
    { name: 'NonNullAWSJson', check: (val: String) => val === 'JSON!', update: () => NonNullAWSJson },
  ]
  if (isScalarType(field.type.ofType)) {
    // console.log('>>> found non null scalar', field.type.ofType)
    things.forEach((rule) => {
      if (rule.check(field.type.toString())) {
        field.type = rule.update()
      }
    })
  }
}

function updateInputTypes(fields: GraphQLInputFieldConfigMap) {
  Object.entries(fields).forEach(([k, field]) => {
    if (isScalarType(field.type)) {
      replacer(field as GenericField)
    }
    if (isNonNullType(field.type)) {
      nonNullReplacer(field as NonNullGenericField)
    }
  })
}
function updateObjectTypes(fields: GraphQLFieldConfigMap<any, any>) {
  Object.entries(fields).forEach(([k, field]) => {
    if (isScalarType(field.type)) {
      replacer(field as GenericField)
    }
    if (isNonNullType(field.type)) {
      nonNullReplacer(field as NonNullGenericField)
    }
    if (field.args) {
      Object.entries(field.args).forEach(([k, arg]) => {
        if (isScalarType(arg.type)) {
          replacer(arg as GenericField)
        }
        if (isNonNullType(arg.type)) {
          nonNullReplacer(arg as NonNullGenericField)
        }
      })
    }
  })
}

export async function loadGraphqlSchema(pgConfig: Pool, schemas: string[], settings?: any) {
  return await createPostGraphileSchema(pgConfig, schemas, {
    appendPlugins: [simplifyInflectorPlugin, forceNullablePlugin, removeNestedQueryFieldPlugin],
    skipPlugins: [NodePlugin, MutationPayloadQueryPlugin],
    graphileBuildOptions: {
      pgShortPk: true,
      pgSimplifyAllRows: true,
      pgOmitListSuffix: true,
    },
    legacyRelations: 'omit',
    ignoreRBAC: false,
    simpleCollections: 'only',
    ...settings,
  })
}
/**
 * From a Graphile provided schema, identifies Payload Objects and determines which types they are wrapping
 * @param  {GraphQLSchema} schema
 */
export function getWrappers(schema: GraphQLSchema) {
  const types = schema.getTypeMap()
  const names = Object.keys(types)
  const wrappers: { [key: string]: any } = {}
  for (const typeName of names) {
    if (typeName.match(/\w+Payload/)) {
      const type = types[typeName]
      if (isObjectType(type)) {
        // console.log('Payload Type:', typeName)
        for (const [fieldName, field] of Object.entries(type.getFields())) {
          const reg = new RegExp(`\\w+${fieldName}Payload`, 'i')
          if (typeName.match(reg)) {
            // console.log('  - found wrapped fieldname:', fieldName)
            wrappers[typeName] = {
              fieldName,
              fieldType: field.type.toString(),
            }
          }
        }
      }
    }
  }
  return wrappers
}
/**
 * Transforms a schema into a AppSync compliant schema string
 * @param  {GraphQLSchema} schema
 */
export function toAppSyncSchema(schema: GraphQLSchema) {
  const str = printSchema(schema, { commentDescriptions: true })
  console.log('>>> pre appsync schema')
  console.log(str)
  console.log('<<< pre appsync schema')

  const printed = str
    // .replace(/(\s|\[)BigInt/g, '$1Int')
    // .replace(/(\s|\[)BigFloat/g, '$1Float')
    // .replace(/(\s|\[)Cursor/g, '$1String')
    // .replace(/(\s|\[)Time/g, '$1String')
    // .replace(/(\s|\[)Datetime/g, '$1AWSDateTime')
    // .replace(/(\s|\[)Date/g, '$1AWSDate')
    // .replace(/(\s|\[)UUID/g, '$1ID')
    .replace(/scalar .*\n/g, '')
    // .replace(/ *#.*\n/g, '')
    .replace(/\n *\n/g, '\n')

  return printed
  // return convertComments(printed)
}
/**
 * Takes in a schema string and transofrms multi-line comments into single line comments
 * @param  {string} schema a GraphQL schema SDL
 */
const convertComments = (schema: string) => {
  const reg = /^(\s*)"""\s*([^"]+)\s*"""\s*$/gm

  const replacer = (match: string, p1: string, ...rest: any[]) => {
    // console.log('>>>')
    // console.log(`p1: [${p1}]`)
    // console.log(match)
    const replacement = match
      .replace(/^\s*"""\s*/, '')
      .replace(/\s*"""\s*$/, '')
      .split('\n')
      .map((s) => p1.replace(/./g, ' ') + '# ' + s.trim())
      .join('\n')
    // console.log(`out: [${replacement}]`)
    // console.log('<<<')
    // console.log()
    return replacement
  }

  const ns = schema.replace(reg, replacer)
  return ns
}

interface Config {
  database: string
  user: string
  password: string
  host: string
  port: number
}
/**
 * Creates a database connection given the configuration
 * @param  {Config} config
 */
export function createDatabaseConnection(config: Config): Pool {
  console.log('Creating new DB connection')
  return new Pool({
    min: 0,
    max: 1,
    idleTimeoutMillis: 0.001,
    ssl: true,
    // settings
    ...config,
  })
}
/**
 * Takes an object and returns a flattend version of the object
 * @param  {{[key:string]:any}|null|undefined} from
 * @param  {{[key:string]:string}} to
 * @param  {string} prefix?
 */
export function toFlatMap(from: { [key: string]: any } | null | undefined, prefix?: string, sep?: string) {
  const SEP = sep || '_'

  if (!from) {
    return {}
  }

  let val: { [key: string]: string } = {}

  Object.entries(from).forEach(([key, value]) => {
    const nextPrefix = prefix ? `${prefix}${SEP}${key}` : key
    if (typeof value === 'object') {
      const inter = toFlatMap(value, nextPrefix)
      val = { ...val, ...inter }
    } else {
      val[nextPrefix] = value
    }
  })
  return val
}
