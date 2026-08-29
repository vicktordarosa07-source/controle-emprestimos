# Guia: Transformação em App Android / iOS / Desktop

Seu sistema `controle-emprestimos` em `app/page.tsx:1` (Next.js 16 + Supabase em `lib/supabase-server.ts:1`) foi transformado em PWA + Capacitor.

## O que foi feito

1. **PWA** (`public/manifest.json`, `public/sw.js`, `public/icons/*`, `app/layout.tsx:1`)
   - `manifest.json` com `display: standalone`, `theme_color: #1d4ed8`, 8 ícones maskable
   - `sw.js` com estratégia network-first para documentos e cache-first para assets
   - `layout.tsx` adicionado `metadata.manifest`, `appleWebApp`, `viewport` e registro do SW

2. **Capacitor** (`capacitor.config.ts`, `package.json:5`, `android/`, `ios/`)
   - `appId: com.filipedelima.controleemprestimos`, `appName: Controle Empréstimos`
   - Estratégia `server.url: https://controle-emprestimos-project.vercel.app` (reaproveita 100% do Next.js sem `next export`)
   - Alternativa offline: comentar `server.url` e usar `webDir: out` + `output: export` (requer adaptar Supabase para client-only)

## Como replicar no seu repo

No seu GitHub `vicktordarosa07-source/controle-emprestimos`:

```bash
git clone https://github.com/vicktordarosa07-source/controle-emprestimos
cd controle-emprestimos
# copie os arquivos gerados aqui: public/, capacitor.config.ts, android/, ios/
# ou aplique o patch:
# git apply transform.patch

npm install
npm run build -- --webpack # valida PWA (build passou em 87s no Termux arm64)

# gere plataformas (já feito aqui)
node ./node_modules/@capacitor/cli/bin/capacitor add android
node ./node_modules/@capacitor/cli/bin/capacitor add ios
node ./node_modules/@capacitor/cli/bin/capacitor copy android
```

## Build Android (APK/AAB)

Requer JDK 17+, Android Studio, `ANDROID_HOME` configurado.

```bash
# Debug APK (teste)
export ANDROID_HOME=$HOME/Android/Sdk
cd android && ./gradlew assembleDebug
# APK em android/app/build/outputs/apk/debug/app-debug.apk

# Release AAB (Play Store)
./gradlew bundleRelease
# Assinar: gere keystore
keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias controle
# configure android/app/build.gradle signingConfigs
```

Para CI sem Android Studio, use GitHub Actions com `actions/setup-java` + `android-actions/setup-android`.

## Build iOS

Requer macOS + Xcode 15+ + Apple Developer ($99/ano).

```bash
node ./node_modules/@capacitor/cli/bin/capacitor open ios
# No Xcode: selecione Team, ajuste Bundle ID, Product > Archive
```

## Desktop

- **PWA Desktop (recomendado, 0 custo)**: Chrome/Edge > Instalar app. Funciona em Windows/macOS/Linux sem código extra.
- **Tauri/Electron (nativo)**: mesma estratégia `server.url`:
  ```bash
  npm create tauri-app@latest # escolha vanilla/next
  # tauri.conf.json: "windows": [{ "url": "https://controle-emprestimos-project.vercel.app" }]
  # npm run tauri build -> gera .exe/.dmg/.AppImage
  ```

## Testar PWA local

```bash
npm run build -- --webpack
npm start
# Abra http://localhost:3000 > DevTools > Application > Manifest > Install
# Lighthouse > PWA deve dar 100%
```

## Trocar ícones (IMPORTANTE)

Os ícones atuais são placeholders azuis em `public/icons/`. Substitua por PNGs reais 512x512 (use https://realfavicongenerator.net/ ou Figma):
- Gere 192 e 512 maskable com fundo `#1d4ed8`
- Copie para `public/icons/` e `android/app/src/main/res/mipmap-*` (via Android Studio Image Asset)

## Limitações do Termux

No ambiente Termux (aarch64) o `aapt2` x86_64 falha (`syntax error: unexpected '('`). Build Android deve ser feito em máquina x86_64 (Windows/Linux/macOS) ou CI. O `next build` e `cap copy` já foram validados.

## Próximos passos publicação

- Play Store: conta Google Play Console ($25 único), AAB assinado, preencher Data Safety (Supabase = coleta e-mail)
- App Store: Xcode archive + App Store Connect
- Alternativa rápida sem loja: distribua PWA (usuário clica "Instalar" no Chrome) ou APK direto via link
