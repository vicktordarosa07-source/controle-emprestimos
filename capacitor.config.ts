import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.filipedelima.controleemprestimos',
  appName: 'Controle Empréstimos',
  // Estratégia híbrida: usa URL hospedada na Vercel
  // Isso reaproveita 100% do Next.js + Supabase sem precisar de static export
  // Para build 100% offline, trocar para webDir: 'out' e usar next export
  webDir: 'public',
  server: {
    url: 'https://controle-emprestimos-project.vercel.app',
    cleartext: false,
    // Permite que o app carregue a URL remota; sem isso tentaria carregar webDir local
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#1d4ed8'
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#1d4ed8'
    }
  },
  // Para iOS/Android nativo, cookies e auth Supabase funcionam via WebView
  // Se quiser offline-first, configure hostname e comente server.url
};

export default config;
