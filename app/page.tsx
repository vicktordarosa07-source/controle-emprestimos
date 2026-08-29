import { supabase } from "@/lib/supabase";
import { NovoEmprestimoModal } from "./components/NovoEmprestimoModal";
import { MarcarPagoButton } from "./components/MarcarPagoButton";

export const dynamic = "force-dynamic";

type ParcelaComCliente = {
  id: string;
  numero: number;
  valor: number;
  data_vencimento: string;
  status: string;
  emprestimo_id: string;
  emprestimos: {
    id: string;
    clientes: { nome: string } | null;
  } | null;
};

function formatCurrency(value: number) {
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("pt-BR");
}

function calcularDiasAtraso(dataVencimento: string, hoje: Date) {
  const venc = new Date(dataVencimento + "T12:00:00");
  const hojeZerado = new Date(hoje);
  hojeZerado.setHours(12, 0, 0, 0);
  venc.setHours(12, 0, 0, 0);
  const diffMs = hojeZerado.getTime() - venc.getTime();
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDias;
}

export default async function Home() {
  const hoje = new Date();
  const yyyy = hoje.getFullYear();
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  const dd = String(hoje.getDate()).padStart(2, "0");
  const hojeStr = `${yyyy}-${mm}-${dd}`;

  // Busca parcelas pendentes com join para nome do cliente
  const { data, error } = await supabase
    .from("parcelas")
    .select(
      `
      id,
      numero,
      valor,
      data_vencimento,
      status,
      emprestimo_id,
      emprestimos (
        id,
        clientes (
          nome
        )
      )
    `
    )
    .eq("status", "Pendente")
    .order("data_vencimento", { ascending: true });

  // Fallback: se a query com join falhar por relação, tenta sem join e busca clientes depois
  let parcelas: ParcelaComCliente[] = [];
  let fetchError: string | null = null;

  if (error) {
    fetchError = error.message;
    // tenta query simples sem join
    const { data: simples, error: err2 } = await supabase
      .from("parcelas")
      .select("*")
      .eq("status", "Pendente")
      .order("data_vencimento", { ascending: true });
    if (!err2 && simples) {
      parcelas = (simples as unknown as ParcelaComCliente[]).map((p) => ({
        ...p,
        emprestimos: null,
      }));
      fetchError = null;
    }
  } else {
    parcelas = (data as unknown as ParcelaComCliente[]) || [];
  }

  const atrasadas = parcelas.filter((p) => p.data_vencimento < hojeStr);
  const aVencer = parcelas.filter((p) => p.data_vencimento >= hojeStr);

  function ParcelaCard({ p }: { p: ParcelaComCliente }) {
    const nomeCliente = p.emprestimos?.clientes?.nome ?? "Cliente";
    const diasAtraso = calcularDiasAtraso(p.data_vencimento, hoje);
    const isAtrasada = p.data_vencimento < hojeStr;

    return (
      <div
        key={p.id}
        className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col gap-3"
      >
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">{nomeCliente}</p>
            <p className="text-sm text-gray-500">
              Parcela {p.numero} • Vencimento: {formatDate(p.data_vencimento)}
            </p>
          </div>
          <span className="shrink-0 bg-gray-100 text-gray-700 text-xs font-medium px-2.5 py-1 rounded-full">
            {formatCurrency(p.valor)}
          </span>
        </div>

        {isAtrasada && (
          <p className="text-sm font-semibold text-red-600">
            {diasAtraso} {diasAtraso === 1 ? "dia" : "dias"} de atraso
          </p>
        )}

        <MarcarPagoButton parcelaId={p.id} />
      </div>
    );
  }

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
              Controle de Empréstimos
            </h1>
            <p className="text-sm text-gray-500">
              Filipe de Lima • {parcelas.length} parcela(s) pendente(s)
            </p>
          </div>
          <NovoEmprestimoModal />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
        {fetchError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
            Erro ao carregar parcelas: {fetchError}
          </div>
        )}

        {/* Resumo rápido */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              Atrasadas
            </p>
            <p className="text-2xl font-bold text-red-600">{atrasadas.length}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              A Vencer
            </p>
            <p className="text-2xl font-bold text-green-600">{aVencer.length}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 col-span-2 sm:col-span-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total pendente</p>
            <p className="text-2xl font-bold text-gray-900">{parcelas.length}</p>
          </div>
        </div>

        {/* Atrasadas */}
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-2 h-6 bg-red-600 rounded-full inline-block" />
            Atrasadas
            <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-1 rounded-full">
              {atrasadas.length}
            </span>
          </h2>

          {atrasadas.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center text-gray-500 text-sm">
              Nenhuma parcela atrasada 🎉
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {atrasadas.map((p) => (
                <ParcelaCard key={p.id} p={p} />
              ))}
            </div>
          )}
        </section>

        {/* A Vencer */}
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-2 h-6 bg-green-600 rounded-full inline-block" />
            A Vencer
            <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-1 rounded-full">
              {aVencer.length}
            </span>
          </h2>

          {aVencer.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center text-gray-500 text-sm">
              Nenhuma parcela a vencer
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {aVencer.map((p) => (
                <ParcelaCard key={p.id} p={p} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
