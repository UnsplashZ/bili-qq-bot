#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { atomicWriteFile } = require('../migrations/common/atomicFile')
const { MigrationError } = require('../migrations/common/errors')
const { requestConfigControl, defaultConfigControlSocketPath } = require('../config/configControl')
const { resolveSchemaNode } = require('../config/schemaV1')
const { stringifyConfigYaml, validateConfigObject } = require('../migrations/config/configDocument')
const { createDefaultV1Config } = require('../migrations/config/legacyLoader')
const { migrateLegacy, validateConfigFile } = require('../migrations/config')
const { ApplicationMigrationBootstrap } = require('../bootstrap/applicationMigrationBootstrap')
const { readManifest, toPublicMigrationStatus } = require('../migrations/config/manifest')
const { renderCompose, readYamlObject } = require('./compose')
const { writeDeploymentBaseline } = require('../config/deploymentBaseline')
const {
    buildDeploymentPlan,
    writeDeploymentPlanArtifact,
    validateRelocationArtifact
} = require('../migrations/config/compose')
const {
    parseArgs,
    requireOption,
    readProtectedJson,
    writeOutput,
    exitWithError,
    resolvePath,
    loadConfigValidator
} = require('./_shared')

const HELP = `Usage: node src/cli/config.js <command> [options]

Commands:
  init --output PATH [--provider napcat|official] [--input FILE] [--force] [--json]
  validate --config PATH [--json]
  get PATH [--socket FILE] [--json]
  set PATH VALUE --expected-generation N [--socket FILE] [--json]
  set-secret PATH (--input FILE|--stdin|--fd N) --expected-generation N [--socket FILE] [--json]
  clear-secret PATH --expected-generation N [--socket FILE] [--json]
  migrate-legacy --legacy-root DIR --output PATH [--manifest FILE]
                 [--runtime-env-file FILE] [--dry-run] [--json]
  status --manifest FILE [--json]
  deployment-plan --config FILE [--existing-compose FILE] --output FILE [--dry-run] [--json]
  record-deployment-applied --config FILE --output FILE [--baseline FILE]
                            [--release-epoch VALUE] [--json]
  render-compose --config FILE --output FILE --ownership-output FILE
                 [--existing-compose FILE] [--ownership FILE] [--adopt-existing]
                 [--validated-relocation-artifact FILE]
                 [--bot-image IMAGE] [--napcat-image IMAGE] [--dry-run] [--json]

Aliases:
  --config-dir is accepted for --legacy-root; --config is accepted for init --output.`

function defaultLegacyCutover(input = {}) {
    return {
        sourceRuntimeClass: 'legacy-v0',
        cutoverKind: 'first-managed-adoption',
        cutoverAttemptId: input.cutoverAttemptId || crypto.randomBytes(16).toString('hex'),
        deliveryGuarantee: 'best-effort',
        exceptionScope: 'legacy-v0-first-cutover-inflight-outbound',
        affectedState: 'operations-without-durable-part-record',
        retryPolicy: 'retry-determinable-uncommitted-parent-or-target',
        ambiguousDeliveryWindow: input.ambiguousDeliveryWindow !== false,
        ambiguousDeliveryWindowStartedAt: input.ambiguousDeliveryWindowStartedAt || null,
        ambiguousDeliveryWindowEndedAt: input.ambiguousDeliveryWindowEndedAt || null,
        fenceCapability: input.fenceCapability || 'unavailable',
        stopMode: input.stopMode || 'graceful',
        fenceAttempted: Boolean(input.fenceAttempted),
        fenceEstablished: Boolean(input.fenceEstablished),
        forcedStop: Boolean(input.forcedStop),
        drainOutcome: input.drainOutcome || 'interrupted',
        legacyFeatureInventory: input.legacyFeatureInventory || [],
        warningCodes: input.warningCodes || ['LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS'],
        appliesToCommittedRuntime: false
    }
}

function summarizeConfig(config) {
    return {
        version: config.version,
        provider: config.qq?.provider || '',
        officialConfigured: Boolean(config.qq?.official?.appId && config.qq?.official?.clientSecret),
        dashboardConfigured: Boolean(config.dashboard?.jwtSecret),
        groupCount: Object.keys(config.groupConfigs || {}).length
    }
}

function cliPathSegments(value) {
    if (typeof value !== 'string' || !value || value.startsWith('/')) {
        throw new MigrationError('CONFIG_CLI_PATH_INVALID')
    }
    const segments = value.split('.')
    if (segments.some((segment) => !segment)) throw new MigrationError('CONFIG_CLI_PATH_INVALID')
    if (!resolveSchemaNode(segments)) throw new MigrationError('CONFIG_CLI_PATH_UNKNOWN')
    return segments
}

function isSecretSchemaPath(segments) {
    for (let index = 1; index <= segments.length; index += 1) {
        if (resolveSchemaNode(segments.slice(0, index))?.secret) return true
    }
    return false
}

function parseCliValue(source) {
    try {
        return JSON.parse(source)
    } catch {
        return String(source)
    }
}

function controlSocketPath(args) {
    return args.socket ? resolvePath(args.socket) : defaultConfigControlSocketPath()
}

async function commandGet(args) {
    const pathValue = cliPathSegments(requireOption(args, '_path'))
    const response = await requestConfigControl(controlSocketPath(args), { action: 'get', path: pathValue })
    return { ok: true, action: 'get', path: pathValue, value: response.value, generation: response.status?.documentGeneration }
}

function expectedGenerationFromArgs(args) {
    const expectedGeneration = Number(requireOption(args, 'expected-generation'))
    if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 1) throw new MigrationError('CONFIG_EXPECTED_GENERATION_INVALID')
    return expectedGeneration
}

function secureSecretFromFile(filePath) {
    const resolved = resolvePath(filePath)
    const before = fs.lstatSync(resolved)
    if (!before.isFile() || before.isSymbolicLink() || before.mode % 0o1000 !== 0o600 || before.nlink !== 1 || before.uid !== process.geteuid()) {
        throw new MigrationError('CONFIG_SECRET_INPUT_UNSAFE')
    }
    if (!Number.isInteger(fs.constants.O_NOFOLLOW)) throw new MigrationError('CONFIG_SECRET_NOFOLLOW_UNAVAILABLE')
    const noFollow = fs.constants.O_NOFOLLOW
    const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow)
    try {
        const after = fs.fstatSync(descriptor)
        if (!after.isFile() || after.mode % 0o1000 !== 0o600 || after.nlink !== 1 || after.uid !== process.geteuid() ||
            after.dev !== before.dev || after.ino !== before.ino) {
            throw new MigrationError('CONFIG_SECRET_INPUT_UNSAFE')
        }
        if (after.size > 1024 * 1024) throw new MigrationError('CONFIG_SECRET_INPUT_TOO_LARGE')
        return fs.readFileSync(descriptor, 'utf8').replace(/\r?\n$/, '')
    } finally {
        fs.closeSync(descriptor)
    }
}

function secretFromDescriptor(descriptor) {
    const metadata = fs.fstatSync(descriptor)
    if (metadata.isFile() && (metadata.mode % 0o1000 !== 0o600 || metadata.nlink !== 1 || metadata.uid !== process.geteuid())) {
        throw new MigrationError('CONFIG_SECRET_INPUT_UNSAFE')
    }
    if (!metadata.isFile() && !metadata.isFIFO() && !metadata.isSocket() && !metadata.isCharacterDevice()) {
        throw new MigrationError('CONFIG_SECRET_INPUT_UNSAFE')
    }
    if (metadata.isFile() && metadata.size > 1024 * 1024) throw new MigrationError('CONFIG_SECRET_INPUT_TOO_LARGE')
    const value = fs.readFileSync(descriptor, 'utf8')
    if (Buffer.byteLength(value) > 1024 * 1024) throw new MigrationError('CONFIG_SECRET_INPUT_TOO_LARGE')
    return value
}

function secretValueFromArgs(args) {
    const sources = [args.input !== undefined, args.stdin === true, args.fd !== undefined].filter(Boolean).length
    if (sources !== 1) throw new MigrationError('CONFIG_SECRET_INPUT_REQUIRED')
    let value
    if (args.input !== undefined) {
        if (typeof args.input !== 'string') throw new MigrationError('CONFIG_SECRET_INPUT_REQUIRED')
        value = secureSecretFromFile(args.input)
    } else {
        const descriptor = args.stdin === true ? 0 : Number(args.fd)
        if (!Number.isSafeInteger(descriptor) || descriptor < 0) throw new MigrationError('CONFIG_SECRET_FD_INVALID')
        value = secretFromDescriptor(descriptor)
        value = value.replace(/\r?\n$/, '')
    }
    if (!value) throw new MigrationError('CONFIG_SECRET_INPUT_EMPTY')
    return value
}

async function commandSet(args, dependencies = {}) {
    const pathValue = cliPathSegments(requireOption(args, '_path'))
    if (isSecretSchemaPath(pathValue)) throw new MigrationError('CONFIG_SECRET_REQUIRES_EXPLICIT_COMMAND')
    const expectedGeneration = expectedGenerationFromArgs(args)
    const value = parseCliValue(requireOption(args, '_value'))
    const requestControl = dependencies.requestConfigControl || requestConfigControl
    const response = await requestControl(controlSocketPath(args), {
        action: 'patch',
        expectedGeneration,
        operations: [{ op: 'set', path: pathValue, value }]
    })
    return { ok: true, action: 'set', result: response.result }
}

async function commandSetSecret(args, dependencies = {}) {
    const pathValue = cliPathSegments(requireOption(args, '_path'))
    if (!isSecretSchemaPath(pathValue)) throw new MigrationError('CONFIG_PATH_IS_NOT_SECRET')
    const expectedGeneration = expectedGenerationFromArgs(args)
    const value = secretValueFromArgs(args)
    const requestControl = dependencies.requestConfigControl || requestConfigControl
    const response = await requestControl(controlSocketPath(args), {
        action: 'patch',
        expectedGeneration,
        operations: [{ op: 'set', path: pathValue, value }]
    })
    return { ok: true, action: 'set-secret', result: response.result }
}

async function commandClearSecret(args, dependencies = {}) {
    const pathValue = cliPathSegments(requireOption(args, '_path'))
    if (!isSecretSchemaPath(pathValue)) throw new MigrationError('CONFIG_PATH_IS_NOT_SECRET')
    const requestControl = dependencies.requestConfigControl || requestConfigControl
    const response = await requestControl(controlSocketPath(args), {
        action: 'patch',
        expectedGeneration: expectedGenerationFromArgs(args),
        operations: [{ op: 'clear-secret', path: pathValue }]
    })
    return { ok: true, action: 'clear-secret', result: response.result }
}

function commandInit(args, dependencies = {}) {
    const configPath = resolvePath(args.output || requireOption(args, 'config'))
    if (fs.existsSync(configPath) && !args.force) throw new MigrationError('CONFIG_FILE_ALREADY_EXISTS')
    const input = readProtectedJson(args.input, { required: false })
    const provider = args.provider || input.provider || 'napcat'
    if (!['napcat', 'official'].includes(provider)) throw new MigrationError('CONFIG_QQ_PROVIDER_INVALID')
    const config = createDefaultV1Config({
        ...input,
        provider,
        jwtSecret: input.jwtSecret || crypto.randomBytes(32).toString('hex')
    })
    const validator = dependencies.validator || loadConfigValidator()
    validateConfigObject(config, { validator })
    atomicWriteFile(configPath, stringifyConfigYaml(config, { validator }), { mode: 0o600 })
    return { ok: true, action: 'init', config: summarizeConfig(config) }
}

function commandValidate(args, dependencies = {}) {
    const configPath = resolvePath(requireOption(args, 'config'))
    const validator = dependencies.validator || loadConfigValidator()
    const config = validateConfigFile(configPath, { validator })
    return { ok: true, action: 'validate', config: summarizeConfig(config) }
}

async function commandMigrateLegacy(args, dependencies = {}) {
    const configDir = resolvePath(args['legacy-root'] || requireOption(args, 'config-dir'))
    const manifestPath = args.manifest ? resolvePath(args.manifest) : undefined
    const outputPath = args.output ? resolvePath(args.output) : (args.config ? resolvePath(args.config) : path.join(configDir, 'config.yaml'))
    const dataDir = args['data-dir']
        ? resolvePath(args['data-dir'])
        : (manifestPath ? path.dirname(manifestPath) : path.resolve(path.dirname(outputPath), '..', 'data'))
    const cutoverInput = readProtectedJson(args['cutover-input'], { required: false })
    const migrationOptions = {
        configDir,
        configPath: outputPath,
        dataDir,
        migrationDir: args['migration-dir'] ? resolvePath(args['migration-dir']) : undefined,
        manifestPath,
        runtimeEnvFile: args['runtime-env-file'] ? resolvePath(args['runtime-env-file']) : undefined,
        requireRuntimeEnvSnapshot: args['allow-missing-runtime-env'] !== true,
        detectedPythonPath: args['detected-python-path'],
        allowGenerateJwtSecret: false,
        dryRun: Boolean(args['dry-run']),
        cutover: defaultLegacyCutover(cutoverInput.cutover || cutoverInput),
        validator: dependencies.validator || loadConfigValidator()
    }
    if (path.resolve(outputPath) !== path.resolve(configDir, 'config.yaml')) {
        throw new MigrationError('CONFIG_BOOTSTRAP_OUTPUT_MUST_BE_CANONICAL')
    }
    const service = dependencies.bootstrap || new ApplicationMigrationBootstrap({
        configDir,
        dataDir,
        migrators: dependencies.migrators
    })
    const result = await service.run({
        runtimeEnv: args['runtime-env-file'] ? readProtectedJson(args['runtime-env-file']) : process.env,
        allowLegacyMigration: true,
        validator: migrationOptions.validator,
        dryRun: Boolean(args['dry-run'])
    })
    if (args['dry-run']) return {
        ok: true, action: 'migrate-legacy', result: 'planned',
        warnings: result.warnings,
        migration: null,
        config: summarizeConfig(result.configValue)
    }
    return {
        ok: true,
        action: 'migrate-legacy',
        result: result.sourceClass === 'managed-v1+' ? 'skipped-existing-yaml' : 'candidate-written',
        warnings: result.warnings.map((warning) => ({ code: warning.code, path: warning.path })),
        migration: result.publicStatus,
        config: summarizeConfig(validateConfigFile(outputPath, { validator: migrationOptions.validator }))
    }
}

function composeOptions(args, dependencies = {}) {
    const validator = dependencies.validator || loadConfigValidator()
    const configPath = resolvePath(requireOption(args, 'config'))
    const existingComposePath = args['existing-compose'] ? resolvePath(args['existing-compose']) : null
    const relocationPlan = buildDeploymentPlan({
        configPath,
        existingComposePath,
        readCompose: readYamlObject,
        validator
    })
    let validatedRelocationArtifact = false
    if (args['validated-relocation-artifact'] !== undefined) {
        if (typeof args['validated-relocation-artifact'] !== 'string') {
            throw new MigrationError('DEPLOYMENT_RELOCATION_ARTIFACT_REQUIRED')
        }
        validateRelocationArtifact(resolvePath(args['validated-relocation-artifact']), relocationPlan)
        validatedRelocationArtifact = true
    }
    return {
        configPath,
        existingComposePath,
        ownershipPath: args.ownership ? resolvePath(args.ownership) : null,
        outputPath: args.output ? resolvePath(args.output) : null,
        ownershipOutputPath: args['ownership-output'] ? resolvePath(args['ownership-output']) : null,
        adoptExisting: Boolean(args['adopt-existing']),
        adoptKnownTemplate: Boolean(args['adopt-known-template']),
        validatedRelocationArtifact,
        botImage: args['bot-image'] || null,
        napcatImage: args['napcat-image'] || null,
        dryRun: Boolean(args['dry-run']),
        validator,
        relocationPlan
    }
}

function commandDeploymentPlan(args, dependencies = {}) {
    const options = composeOptions(args, dependencies)
    const plan = options.relocationPlan
    if (!options.dryRun) {
        writeDeploymentPlanArtifact(resolvePath(requireOption(args, 'output')), plan)
    }
    return {
        ok: true,
        action: 'deployment-plan',
        plan: {
            version: plan.version,
            provider: plan.provider,
            requiresRelocation: plan.requiresRelocation,
            requiredOperationCount: plan.requiredOperationCount,
            mounts: plan.mounts.map((mount) => ({
                key: mount.key,
                containerTarget: mount.containerTarget,
                preserveRequired: mount.preserveRequired,
                changes: mount.oldSource !== null && mount.oldSource !== mount.newSource
            }))
        }
    }
}

function commandRecordDeploymentApplied(args, dependencies = {}) {
    const configPath = resolvePath(requireOption(args, 'config'))
    const outputPath = resolvePath(requireOption(args, 'output'))
    const previousPath = args.baseline ? resolvePath(args.baseline) : outputPath
    const validator = dependencies.validator || loadConfigValidator()
    const config = validateConfigFile(configPath, { validator })
    const baseline = writeDeploymentBaseline(outputPath, config, {
        previousPath,
        releaseEpoch: typeof args['release-epoch'] === 'string' ? args['release-epoch'] : null
    })
    return {
        ok: true,
        action: 'record-deployment-applied',
        deployment: {
            generation: baseline.generation,
            fingerprint: baseline.fingerprint,
            releaseEpoch: baseline.releaseEpoch
        }
    }
}

function commandRenderCompose(args, dependencies = {}) {
    const result = renderCompose(composeOptions(args, dependencies))
    return {
        ok: true,
        action: 'render-compose',
        provider: result.plan.provider,
        deploymentApplyRequired: result.plan.deploymentApplyRequired,
        ownershipRequired: result.plan.ownershipRequired,
        mountRelocationRequired: result.plan.mountRelocationRequired,
        ownedPointers: result.ownership.ownedPointers
    }
}

function commandStatus(args) {
    const manifest = readManifest(resolvePath(requireOption(args, 'manifest')))
    return { ok: true, action: 'status', migration: toPublicMigrationStatus(manifest) }
}

function run(argv = process.argv.slice(2), dependencies = {}) {
    const args = parseArgs(argv)
    const command = args._[0]
    if (command === 'get') args._path = args._[1]
    if (command === 'set') {
        args._path = args._[1]
        args._value = args._[2]
    }
    if (command === 'set-secret' || command === 'clear-secret') args._path = args._[1]
    if (args.help || command === 'help') return HELP
    if (command === 'init') return commandInit(args, dependencies)
    if (command === 'validate') return commandValidate(args, dependencies)
    if (command === 'get') return commandGet(args)
    if (command === 'set') return commandSet(args, dependencies)
    if (command === 'set-secret') return commandSetSecret(args, dependencies)
    if (command === 'clear-secret') return commandClearSecret(args, dependencies)
    if (command === 'migrate-legacy') return commandMigrateLegacy(args, dependencies)
    if (command === 'status') return commandStatus(args)
    if (command === 'deployment-plan') return commandDeploymentPlan(args, dependencies)
    if (command === 'record-deployment-applied') return commandRecordDeploymentApplied(args, dependencies)
    if (command === 'render-compose') return commandRenderCompose(args, dependencies)
    throw new MigrationError('CLI_COMMAND_UNKNOWN')
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2))
    Promise.resolve(run(process.argv.slice(2)))
        .then((result) => writeOutput(result, Boolean(args.json)))
        .catch((error) => exitWithError(error, Boolean(args.json)))
}

module.exports = {
    run,
    commandInit,
    commandValidate,
    commandGet,
    commandSet,
    commandSetSecret,
    commandClearSecret,
    commandMigrateLegacy,
    commandStatus,
    defaultLegacyCutover,
    summarizeConfig,
    commandDeploymentPlan,
    commandRecordDeploymentApplied,
    commandRenderCompose,
    HELP
}
