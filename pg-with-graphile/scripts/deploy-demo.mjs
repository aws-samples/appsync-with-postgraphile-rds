import { readFile } from 'fs/promises'
import { spawn } from 'child_process'
import arg from 'arg'

const config = JSON.parse(await readFile(new URL('../../vpc-with-pg/output.json', import.meta.url)))

// vpc info
const vpcId = config.PgVpcStack.VPCID
const sgId = config.PgRdsStack.LambdaSecurityGroupId

// rds proxy info
const dbProxyArn = config.PgRdsStack.RDSProxyARN
const dbProxyName = config.PgRdsStack.RDSProxyName
const endpoint = config.PgRdsStack.RDSProxyEndpoint

async function run() {
  const args = arg({ '--username': String, '--database': String, '--schemas': String })

  const reqs = [('--username', '--database', '--schemas')]
  reqs.forEach((a) => {
    if (!args[a]) throw new Error(`missing required argument: ${a}`)
  })

  const username = args['--username']
  const database = args['--database']
  const schemas = args['--schemas']

  doNpmDeploy(vpcId, sgId, dbProxyArn, dbProxyName, endpoint, username, database, schemas)
}

async function doNpmDeploy(vpcId, sgId, dbProxyArn, dbProxyName, endpoint, username, database, schemas) {
  const opts = `-c vpcId=${vpcId} \
  --parameters sgId=${sgId} \
  --parameters dbProxyArn=${dbProxyArn} \
  --parameters dbProxyName=${dbProxyName} \
  --parameters dbProxyEndpoint=${endpoint} \
  --parameters userName=${username} \
  --parameters database=${database} \
  --parameters schemas=${schemas} \
  -O output.json`.split(/\s+/)

  spawn('npm', ['run', 'cdk', 'deploy', '--', ...opts], { stdio: 'inherit' })
}

run()
