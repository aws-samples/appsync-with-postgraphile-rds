import * as AWS from 'aws-sdk'
import { Pool } from 'pg'
import * as fs from 'fs'

var secretsmanager = new AWS.SecretsManager()

let pgPool: Pool

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
function createDatabaseConnection(config: Config): Pool {
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

const PORT = parseInt(process.env.PORT!)
const signer = new AWS.RDS.Signer({
  region: process.env.REGION,
  port: PORT,
  username: process.env.USERNAME,
  hostname: process.env.RDS_PROXY_URL,
})

async function cleanup() {
  const config = {
    database: process.env.DATABASE!,
    user: process.env.USERNAME!,
    password: signer.getAuthToken({}),
    host: process.env.RDS_PROXY_URL!,
    port: PORT,
  }
  pgPool = createDatabaseConnection(config)
  let client = await pgPool.connect()

  try {
    await client.query('drop schema if exists forum_example cascade;')
    await client.query('drop schema if exists forum_example_private cascade;')
    await client.query('drop role if exists forum_example_person, forum_example_anonymous, lambda_runner;')
    client.release()
    await pgPool.end()
    config.database = 'postgres'
    pgPool = createDatabaseConnection(config)
    client = await pgPool.connect()
    await client.query('drop database ' + process.env.DATABASE)
  } catch (e) {
    await client.query('ROLLBACK')
    console.log('rolled back')
    throw e
  } finally {
    client.release()
  }
}

export const handler = async (event: any): Promise<any> => {
  if (event.cleanup) {
    console.log('clean up database')
    return await cleanup()
  }

  console.log('start db schema init process', event)
  const { SecretString } = await secretsmanager.getSecretValue({ SecretId: process.env.SECRET_ARN! }).promise()
  if (!SecretString) {
    throw new Error('could not retrieve secret')
  }
  const secrets = JSON.parse(SecretString)

  const config = {
    database: 'postgres',
    user: process.env.USERNAME!,
    password: signer.getAuthToken({}),
    host: process.env.RDS_PROXY_URL!,
    port: PORT,
  }
  pgPool = createDatabaseConnection(config)
  let client = await pgPool.connect()

  try {
    await client.query('CREATE DATABASE ' + process.env.DATABASE!)
    client.release()
    await pgPool.end()

    console.log(`created database ${process.env.DATABASE}`)

    config.database = process.env.DATABASE!
    pgPool = createDatabaseConnection(config)
    client = await pgPool.connect()

    const dir = '/opt/lib'
    const file = `${dir}/dbschema.sql`
    let queries = fs
      .readFileSync(file)
      .toString()
      .replace('<<<lambda_runner_password>>>', secrets.password)
      .split(/\r\n|\n|\r/) // split new lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0) // remove any empty ones

    console.log(`executing queries (${queries.length})`)

    // Execute each SQL query sequentially
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i]
      await client.query(q)
    }
  } catch (e) {
    await client.query('ROLLBACK')
    console.log('rolled back')
    throw e
  } finally {
    client.release()
  }
}
