import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const storeUrl = new URL('../server/session-store.js', import.meta.url).href;

test('restores encrypted sessions after restart and removes them on logout', () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), 'xmail-session-'));
  const environment = {
    ...process.env,
    XMAIL_DATA_DIR: dataDirectory,
    SESSION_SECRET: 'test-only-stable-session-secret',
  };
  delete environment.NODE_TEST_CONTEXT;

  try {
    const sessionId = run(`
      import { addAccount, createSession, getSession } from ${JSON.stringify(storeUrl)};
      const id = createSession();
      addAccount(getSession(id), {
        email: 'restore@example.com',
        provider: 'Test Mail',
        family: 'test',
        authorizationCode: 'encrypted-secret',
      });
      process.stdout.write(id);
    `, environment);

    const restored = JSON.parse(run(`
      import { getSession } from ${JSON.stringify(storeUrl)};
      const session = getSession(${JSON.stringify(sessionId)});
      const account = [...session.accounts.values()][0];
      process.stdout.write(JSON.stringify({
        email: account.email,
        authorizationCode: account.authorizationCode,
      }));
    `, environment));

    assert.deepEqual(restored, {
      email: 'restore@example.com',
      authorizationCode: 'encrypted-secret',
    });

    run(`
      import { deleteSession } from ${JSON.stringify(storeUrl)};
      deleteSession(${JSON.stringify(sessionId)});
    `, environment);

    assert.equal(run(`
      import { getSession } from ${JSON.stringify(storeUrl)};
      process.stdout.write(String(getSession(${JSON.stringify(sessionId)}) === null));
    `, environment), 'true');
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

function run(source, environment) {
  return execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8',
    env: environment,
  }).trim();
}
