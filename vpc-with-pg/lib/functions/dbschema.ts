import * as AWS from 'aws-sdk';
import { Pool } from 'pg';
import * as fs from 'fs';



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
const createDatabaseConnection: Pool = (config: Config) => {
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



export const handler = async (event: any): Promise<any> => {
    console.log('start db schema init process')

    const config = {
        database: process.env.DATABASE!,
        user: process.env.USERNAME!,
        password: signer.getAuthToken({}),
        host: process.env.RDS_PROXY_URL!,
        port: PORT,
    }

    pgPool = createDatabaseConnection(config);
    const client = await pgPool.connect();

    try {

        const dir = '/pg-dbschema-layer/nodejs'
        const file = `${dir}/dbschema.sql`
        let queries = fs.readFileSync(file).toString()
            .replace(/(\r\n|\n|\r)/gm, " ") // remove newlines
            .replace(/\s+/g, ' ') // excess white space
            .split(";") // split into all statements
            .map(Function.prototype.call, String.prototype.trim)
            .filter((el: any) => { return el.length != 0 }); // remove any empty ones

        // Execute each SQL query sequentially
        queries.forEach((query: string) => {
            client.query(query);
        });

    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }

}

