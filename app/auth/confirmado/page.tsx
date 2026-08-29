import Link from "next/link";

type ConfirmadoPageProps = {
  searchParams?: Promise<{
    status?: string;
  }>;
};

export default async function ConfirmadoPage({ searchParams }: ConfirmadoPageProps) {
  const params = (await searchParams) ?? {};
  const success = params.status === "sucesso";

  return (
    <main className="grid min-h-screen place-items-center bg-gray-50 px-4">
      <section className="w-full max-w-md border border-gray-200 bg-white p-6 text-center shadow-sm">
        <div
          className={
            success
              ? "mx-auto grid h-12 w-12 place-items-center bg-emerald-100 text-2xl font-black text-emerald-700"
              : "mx-auto grid h-12 w-12 place-items-center bg-red-100 text-2xl font-black text-red-700"
          }
        >
          {success ? "✓" : "!"}
        </div>

        <h1 className="mt-5 text-2xl font-bold text-gray-950">
          {success ? "E-mail validado com sucesso" : "Não foi possível validar o e-mail"}
        </h1>
        <p className="mt-3 text-sm font-medium text-gray-600">
          {success
            ? "Seu cadastro foi confirmado. Agora você já pode acessar o sistema."
            : "O link pode estar vencido ou já ter sido usado. Tente entrar novamente ou refaça o cadastro."}
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 w-full items-center justify-center bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800"
        >
          Ir para o sistema
        </Link>
      </section>
    </main>
  );
}
