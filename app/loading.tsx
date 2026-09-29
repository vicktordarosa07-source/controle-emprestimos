export default function Loading() {
  return (
    <main className="min-h-screen bg-gray-50" aria-busy="true">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-gray-950 sm:text-2xl">Recebify • Gestão de cobranças</h1>
            <p className="mt-2 h-4 w-52 animate-pulse bg-gray-200" aria-hidden="true" />
          </div>
          <div className="h-10 w-36 animate-pulse bg-gray-200" aria-hidden="true" />
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <p role="status" className="sr-only">Carregando suas cobranças…</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-3 border border-gray-200 bg-white p-4">
              <div className="h-3 w-28 animate-pulse bg-gray-200" />
              <div className="h-7 w-36 animate-pulse bg-gray-200" />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 border border-gray-200 bg-white p-3" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-10 w-28 animate-pulse bg-gray-200" />
          ))}
        </div>
        <div className="space-y-3 border border-gray-200 bg-white p-4" aria-hidden="true">
          <div className="h-5 w-40 animate-pulse bg-gray-200" />
          <div className="h-11 w-full animate-pulse bg-gray-100" />
          <div className="h-20 w-full animate-pulse bg-gray-100" />
        </div>
      </div>
    </main>
  );
}
