import { Signer } from "@aws-sdk/rds-signer";
import { Pool } from "pg";
import * as fs from "fs";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const PORT = parseInt(process.env.PORT!);


let pgPool: Pool | null = null;

const signer = new Signer({
  region: process.env.AWS_REGION,
  port: PORT,
  username: process.env.USERNAME || "postgres",
  hostname: process.env.RDS_PROXY_URL || "",
});

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
    ...config,
  })
}

async function ensurePoolClosed(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
}

async function cleanup(): Promise<void> {
  let client;

  try {
    const config = {
      database: process.env.DATABASE!,
      user: process.env.USERNAME || "postgres",
      password: await signer.getAuthToken(),
      host: process.env.RDS_PROXY_URL || "",
      port: PORT,
    };

    pgPool = createDatabaseConnection(config);
    console.log("Starting database cleanup");

    client = await pgPool.connect();

    // Drop schemas and roles
    await client.query("DROP SCHEMA IF EXISTS forum_example CASCADE;");
    await client.query("DROP SCHEMA IF EXISTS forum_example_private CASCADE;");
    await client.query(
      "DROP ROLE IF EXISTS forum_example_person, forum_example_anonymous, lambda_runner;"
    );

    client.release();
    client = null;
    await ensurePoolClosed();

    // Connect to postgres database to drop the target database
    config.database = "postgres";
    pgPool = createDatabaseConnection(config);
    client = await pgPool.connect();
    await client.query(`DROP DATABASE IF EXISTS ${process.env.DATABASE}`);

    console.log("Database cleanup completed successfully");
  } catch (error) {
    console.error("Error during cleanup:", error);
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Error during rollback:", rollbackError);
      }
    }
    throw error;
  } finally {
    if (client) {
      client.release();
    }
    await ensurePoolClosed();
  }
}

interface HandlerEvent {
  cleanup?: boolean;
}

interface DatabaseSecrets {
  password: string;
}

async function executeSchemaSetup(): Promise<void> {
  let client;

  try {
    console.log("Starting database schema initialization");

    // Get secrets
    const secretsManagerClient = new SecretsManagerClient({
      region: process.env.AWS_REGION,
    });

    const { SecretString } = await secretsManagerClient.send(
      new GetSecretValueCommand({ SecretId: process.env.SECRET_ARN! })
    );

    if (!SecretString) {
      throw new Error("Could not retrieve secret from Secrets Manager");
    }

    const secrets: DatabaseSecrets = JSON.parse(SecretString);

    // Create database
    const config = {
      database: "postgres",
      user: process.env.USERNAME!,
      password: await signer.getAuthToken(),
      host: process.env.RDS_PROXY_URL!,
      port: PORT,
    };

    pgPool = createDatabaseConnection(config);
    client = await pgPool.connect();

    // PostgreSQL doesn't support CREATE DATABASE IF NOT EXISTS, so we need to check first
    const dbCheckResult = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [process.env.DATABASE!]
    );

    if (dbCheckResult.rows.length === 0) {
      await client.query(`CREATE DATABASE ${process.env.DATABASE!}`);
      console.log(`Created database: ${process.env.DATABASE}`);
    } else {
      console.log(`Database ${process.env.DATABASE} already exists`);
    }
    client.release();
    client = null;
    await ensurePoolClosed();

    console.log(`Created database: ${process.env.DATABASE}`);

    // Connect to the new database and execute schema
    config.database = process.env.DATABASE!;
    pgPool = createDatabaseConnection(config);
    client = await pgPool.connect();

    // Read and process SQL file
    const sqlFilePath = "./dbschema.sql";

    if (!fs.existsSync(sqlFilePath)) {
      throw new Error(`SQL file not found: ${sqlFilePath}`);
    }

    const sqlContent = fs.readFileSync(sqlFilePath, "utf8");
    const processedSql = sqlContent.replace(
      "<<<lambda_runner_password>>>",
      secrets.password
    );

    // Split into individual queries, filtering out empty lines and comments
    const queries = processedSql
      .split(/\r\n|\n|\r/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("--"));

    console.log(`Executing ${queries.length} SQL queries`);

    // Execute queries in a transaction
    await client.query("BEGIN");

    for (const [index, query] of queries.entries()) {
      try {
        await client.query(query);
        if ((index + 1) % 10 === 0) {
          console.log(`Executed ${index + 1}/${queries.length} queries`);
        }
      } catch (queryError) {
        console.error(`Error executing query ${index + 1}: ${query}`);
        throw queryError;
      }
    }

    await client.query("COMMIT");
    console.log("Database schema initialization completed successfully");
  } catch (error) {
    console.error("Error during schema setup:", error);
    if (client) {
      try {
        await client.query("ROLLBACK");
        console.log("Transaction rolled back");
      } catch (rollbackError) {
        console.error("Error during rollback:", rollbackError);
      }
    }
    throw error;
  } finally {
    if (client) {
      client.release();
    }
    await ensurePoolClosed();
  }
}

export const handler = async (
  event: HandlerEvent
): Promise<{ success: boolean; message: string }> => {
  try {
    if (event.cleanup) {
      console.log("Starting database cleanup");
      await cleanup();
      return {
        success: true,
        message: "Database cleanup completed successfully",
      };
    }

    await executeSchemaSetup();
    return {
      success: true,
      message: "Database schema initialization completed successfully",
    };
  } catch (error) {
    console.error("Handler error:", error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
};
