import { getCliCapabilities, resolveChromeDevtoolsCliRunner } from './lib/cli-runner.mjs';
import { attachCliToBrowserTarget } from './lib/session-actions.mjs';
import { runJsonCliScript } from './lib/script-runtime.mjs';

function readArgument(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find(argument => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

await runJsonCliScript(import.meta.url, async () => {
  const cliRunner = await resolveChromeDevtoolsCliRunner();
  const helpInfo = cliRunner.helpInfo ?? {};
  const { autoConnectMode } = getCliCapabilities(helpInfo);
  const browserUrl = readArgument('browserUrl');
  const wsEndpoint = readArgument('wsEndpoint');
  const useAutoConnect = hasFlag('autoConnect');

  if (!browserUrl && !wsEndpoint && !useAutoConnect) {
    throw new Error('Usage: node start-cli-session.mjs --browserUrl=http://127.0.0.1:9222 OR --wsEndpoint=ws://... OR --autoConnect');
  }

  const browserTarget = useAutoConnect
    ? {
      transport: 'autoConnect',
      autoConnectMode,
      mode: 'reuse-running',
    }
    : wsEndpoint
      ? {
        transport: 'wsEndpoint',
        webSocketDebuggerUrl: wsEndpoint,
        browserUrl,
      }
      : {
        transport: 'browserUrl',
        browserUrl,
      };

  return await attachCliToBrowserTarget({
    cliRunner,
    browserTarget,
  });
});
