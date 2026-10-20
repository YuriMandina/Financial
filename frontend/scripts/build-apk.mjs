// Gera o APK do app de contagem e publica no backend (backend/static/mobile) para download pelos celulares.
// Uso: npm run apk            (antes, incremente versionCode em mobile-version.json para avisar os aparelhos)
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const version = JSON.parse(readFileSync(join(root, 'mobile-version.json'), 'utf-8'));

// --- [BLOCO: Ambiente Java/Android] ---
function findJavaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  const base = 'C:/Program Files/Eclipse Adoptium';
  const jdk = existsSync(base) && readdirSync(base).filter((d) => d.startsWith('jdk-21')).sort().pop();
  if (!jdk) throw new Error('JDK 21 não encontrado. Instale: winget install EclipseAdoptium.Temurin.21.JDK');
  return join(base, jdk);
}
const env = {
  ...process.env,
  JAVA_HOME: findJavaHome(),
  ANDROID_HOME: process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
};
if (!existsSync(join(root, 'android-signing', 'keystore.properties'))) {
  throw new Error('Assinatura ausente: android-signing/keystore.properties (restaure o backup da chave).');
}

const run = (cmd, cwd = root) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, env, stdio: 'inherit' });
};

// --- [BLOCO: Build] ---
run('npm run build:mobile');
run('npx cap sync android');
const gradlew = join(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
run(`"${gradlew}" assembleRelease`, join(root, 'android'));

// --- [BLOCO: Publicação no Backend] ---
const apk = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const target = resolve(root, '..', 'backend', 'static', 'mobile');
mkdirSync(target, { recursive: true });
copyFileSync(apk, join(target, 'contagem.apk'));
writeFileSync(join(target, 'version.json'), JSON.stringify(version, null, 2));
console.log(`\nAPK ${version.versionName} (código ${version.versionCode}) publicado em ${target}`);
