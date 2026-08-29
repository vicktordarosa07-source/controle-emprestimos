import { diasAtraso, formatDateOnly } from "@/lib/loan-utils";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AuthPanel, SignOutButton } from "./components/AuthPanel";
import { NovoEmprestimoModal } from "./components/NovoEmprestimoModal";
import { MarcarPagoButton } from "./components/MarcarPagoButton";
import { RegistrarPagamentoForm } from "./components/RegistrarPagamentoForm";

export const dynamic = "force-dynamic";

type ParcelaStatus = "Pendente" | "Pago" | string;
type ViewFilter = "abertas" | "atrasadas" | "pagas" | "todas";

type ParcelaComCliente = {
  id: string;
  numero: number;
  valor: number;
  valor_pago: number | null;
  data_vencimento: string;
  data_pagamento: string | null;
  status: ParcelaStatus;
  emprestimo_id: string;
  emprestimos: {
    id: string;
    clientes: { id: string; nome: string } | null;
  } | null;
};

type ClienteResumo = {
  clienteId: string;
  nome: string;
  parcelas: ParcelaComCliente[];
  proximaParcela: ParcelaComCliente | null;
  totalRestante: number;
  totalAtrasado: number;
  atrasadas: number;
  proximoVencimento: string | null;
};

type PageProps = {
  searchParams?: Promise<{
    q?: string;
    view?: string;
  }>;
};

const viewLabels: Record<ViewFilter, string> = {
  abertas: "Em aberto",
  atrasadas: "Atrasadas",
  pagas: "Pagas",
  todas: "Todas",
};

function formatCurrency(value: number) {
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("pt-BR");
}

function getNomeCliente(parcela: ParcelaComCliente) {
  return parcela.emprestimos?.clientes?.nome ?? "Cliente sem nome";
}

function getClienteId(parcela: ParcelaComCliente) {
  return parcela.emprestimos?.clientes?.id ?? `sem-cliente:${getNomeCliente(parcela)}`;
}

function getValorPago(parcela: ParcelaComCliente) {
  return Number(parcela.valor_pago ?? 0);
}

function getSaldoParcela(parcela: ParcelaComCliente) {
  return Math.max(Number(parcela.valor) - getValorPago(parcela), 0);
}

function sumSaldoRestante(parcelas: ParcelaComCliente[]) {
  return parcelas.reduce((total, parcela) => total + getSaldoParcela(parcela), 0);
}

function sumValorPago(parcelas: ParcelaComCliente[]) {
  return parcelas.reduce((total, parcela) => total + getValorPago(parcela), 0);
}

function agruparPorCliente(parcelas: ParcelaComCliente[], hojeStr: string) {
  const grupos = new Map<string, ParcelaComCliente[]>();

  for (const parcela of parcelas) {
    const clienteId = getClienteId(parcela);
    const existentes = grupos.get(clienteId) ?? [];
    existentes.push(parcela);
    grupos.set(clienteId, existentes);
  }

  return Array.from(grupos.entries())
    .map(([clienteId, parcelasDoCliente]) => {
      const abertas = parcelasDoCliente.filter((parcela) => parcela.status !== "Pago");
      const atrasadas = abertas.filter((parcela) => parcela.data_vencimento < hojeStr);
      const proximas = [...abertas].sort((a, b) =>
        a.data_vencimento.localeCompare(b.data_vencimento)
      );

      return {
        clienteId,
        nome: getNomeCliente(parcelasDoCliente[0]),
        parcelas: abertas,
        proximaParcela: proximas[0] ?? null,
        totalRestante: sumSaldoRestante(abertas),
        totalAtrasado: sumSaldoRestante(atrasadas),
        atrasadas: atrasadas.length,
        proximoVencimento: proximas[0]?.data_vencimento ?? null,
      };
    })
    .filter((cliente) => cliente.parcelas.length > 0)
    .sort((a, b) => {
      if (b.atrasadas !== a.atrasadas) {
        return b.atrasadas - a.atrasadas;
      }

      if (b.totalRestante !== a.totalRestante) {
        return b.totalRestante - a.totalRestante;
      }

      return a.nome.localeCompare(b.nome, "pt-BR");
    });
}

function normalizeView(value: string | undefined): ViewFilter {
  if (value === "atrasadas" || value === "pagas" || value === "todas") {
    return value;
  }

  return "abertas";
}

function buildHref(view: ViewFilter, q: string) {
  const params = new URLSearchParams();
  params.set("view", view);

  if (q) {
    params.set("q", q);
  }

  return `/?${params.toString()}`;
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "red" | "green" | "blue" | "gray";
}) {
  const toneClass = {
    red: "text-red-700",
    green: "text-emerald-700",
    blue: "text-blue-700",
    gray: "text-gray-900",
  }[tone];

  return (
    <div className="border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function FilterLink({
  view,
  activeView,
  q,
  count,
}: {
  view: ViewFilter;
  activeView: ViewFilter;
  q: string;
  count: number;
}) {
  const active = view === activeView;

  return (
    <a
      href={buildHref(view, q)}
      className={
        active
          ? "border border-blue-700 bg-blue-700 px-3 py-2 text-sm font-semibold text-white"
          : "border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
      }
    >
      {viewLabels[view]} ({count})
    </a>
  );
}

function ParcelaCard({
  parcela,
  hoje,
  hojeStr,
}: {
  parcela: ParcelaComCliente;
  hoje: Date;
  hojeStr: string;
}) {
  const nomeCliente = getNomeCliente(parcela);
  const isPaga = parcela.status === "Pago";
  const isAtrasada = !isPaga && parcela.data_vencimento < hojeStr;
  const atraso = diasAtraso(parcela.data_vencimento, hoje);
  const saldo = getSaldoParcela(parcela);
  const valorPago = getValorPago(parcela);

  return (
    <article className="flex min-h-44 flex-col justify-between gap-4 border border-gray-200 bg-white p-4 shadow-sm">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-gray-950">
              {nomeCliente}
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Parcela {parcela.numero} de {parcela.emprestimo_id.slice(0, 8)}
            </p>
          </div>
          <strong className="shrink-0 bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-800">
            {formatCurrency(saldo)}
          </strong>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Vencimento
            </p>
            <p className="mt-1 font-semibold text-gray-900">
              {formatDate(parcela.data_vencimento)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Status
            </p>
            <p
              className={
                isPaga
                  ? "mt-1 font-semibold text-emerald-700"
                  : isAtrasada
                    ? "mt-1 font-semibold text-red-700"
                    : "mt-1 font-semibold text-blue-700"
              }
            >
              {isPaga ? "Pago" : isAtrasada ? "Atrasada" : "A vencer"}
            </p>
          </div>
        </div>

        {valorPago > 0 && !isPaga ? (
          <p className="border-l-4 border-blue-600 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">
            Pago {formatCurrency(valorPago)} • falta {formatCurrency(saldo)}
          </p>
        ) : null}

        {isAtrasada ? (
          <p className="border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {atraso} {atraso === 1 ? "dia" : "dias"} de atraso
          </p>
        ) : null}

        {isPaga && parcela.data_pagamento ? (
          <p className="border-l-4 border-emerald-600 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
            Pago em {formatDate(parcela.data_pagamento)}
          </p>
        ) : null}
      </div>

      <MarcarPagoButton parcelaId={parcela.id} status={parcela.status} />
    </article>
  );
}

function ClienteCard({ cliente }: { cliente: ClienteResumo }) {
  const proximaParcela = cliente.proximaParcela;

  return (
    <article className="border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-bold text-gray-950">{cliente.nome}</h3>
          <p className="mt-1 text-sm font-medium text-gray-600">
            {cliente.parcelas.length} parcela(s) faltando
          </p>
        </div>

        <div className="bg-blue-50 px-4 py-3 text-left sm:text-right">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
            Falta pagar
          </p>
          <p className="mt-1 text-2xl font-black text-blue-950">
            {formatCurrency(cliente.totalRestante)}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div className="border border-gray-200 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
            Próximo vencimento
          </p>
          <p className="mt-1 font-bold text-gray-950">
            {cliente.proximoVencimento ? formatDate(cliente.proximoVencimento) : "Sem parcelas"}
          </p>
        </div>
        <div className="border border-gray-200 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
            Atrasadas
          </p>
          <p className={cliente.atrasadas > 0 ? "mt-1 font-bold text-red-700" : "mt-1 font-bold text-gray-950"}>
            {cliente.atrasadas} parcela(s)
          </p>
        </div>
        <div className="border border-gray-200 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
            Valor atrasado
          </p>
          <p className={cliente.totalAtrasado > 0 ? "mt-1 font-bold text-red-700" : "mt-1 font-bold text-gray-950"}>
            {formatCurrency(cliente.totalAtrasado)}
          </p>
        </div>
      </div>

      {proximaParcela ? (
        <div className="mt-5 flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
              Próxima parcela
            </p>
            <p className="mt-1 text-sm font-bold text-gray-950">
              Parcela {proximaParcela.numero} • falta{" "}
              {formatCurrency(getSaldoParcela(proximaParcela))} •{" "}
              vence {formatDate(proximaParcela.data_vencimento)}
            </p>
            {getValorPago(proximaParcela) > 0 ? (
              <p className="mt-1 text-xs font-semibold text-blue-700">
                Já pago nesta parcela: {formatCurrency(getValorPago(proximaParcela))}
              </p>
            ) : null}
          </div>
          <div className="w-full sm:max-w-sm">
            <RegistrarPagamentoForm
              clienteId={cliente.clienteId}
              saldoAberto={cliente.totalRestante}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ClientesSection({
  title,
  clientes,
}: {
  title: string;
  clientes: ClienteResumo[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-950">{title}</h2>
        <span className="text-sm font-semibold text-gray-500">
          {clientes.length} cliente(s)
        </span>
      </div>

      {clientes.length === 0 ? (
        <div className="border border-dashed border-gray-300 bg-white p-6 text-center text-sm font-medium text-gray-500">
          Nenhum cliente nesta visão.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {clientes.map((cliente) => (
            <ClienteCard key={cliente.clienteId} cliente={cliente} />
          ))}
        </div>
      )}
    </section>
  );
}

function ParcelasSection({
  title,
  parcelas,
  hoje,
  hojeStr,
}: {
  title: string;
  parcelas: ParcelaComCliente[];
  hoje: Date;
  hojeStr: string;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-950">{title}</h2>
        <span className="text-sm font-semibold text-gray-500">
          {parcelas.length} parcela(s)
        </span>
      </div>

      {parcelas.length === 0 ? (
        <div className="border border-dashed border-gray-300 bg-white p-6 text-center text-sm font-medium text-gray-500">
          Nenhuma parcela nesta visão.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {parcelas.map((parcela) => (
            <ParcelaCard
              key={parcela.id}
              parcela={parcela}
              hoje={hoje}
              hojeStr={hojeStr}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function Home({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const q = (params.q ?? "").trim();
  const normalizedQuery = q.toLocaleLowerCase("pt-BR");
  const activeView = normalizeView(params.view);
  const hoje = new Date();
  const hojeStr = formatDateOnly(hoje);
  let parcelas: ParcelaComCliente[] = [];
  let fetchError: string | null = null;
  let userEmail = "";

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return <AuthPanel />;
    }

    userEmail = user.email ?? "";

    const { data, error } = await supabase
      .from("parcelas")
      .select(
        `
        id,
        numero,
        valor,
        valor_pago,
        data_vencimento,
        data_pagamento,
        status,
        emprestimo_id,
        emprestimos (
          id,
          clientes (
            id,
            nome
          )
        )
      `
      )
      .order("data_vencimento", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    parcelas = (data as unknown as ParcelaComCliente[]) || [];
  } catch (error) {
    fetchError = (error as Error).message;
  }

  const filtradasPorBusca = normalizedQuery
    ? parcelas.filter((parcela) =>
        getNomeCliente(parcela).toLocaleLowerCase("pt-BR").includes(normalizedQuery)
      )
    : parcelas;

  const pagas = filtradasPorBusca.filter((parcela) => parcela.status === "Pago");
  const abertas = filtradasPorBusca.filter((parcela) => parcela.status !== "Pago");
  const atrasadas = abertas.filter((parcela) => parcela.data_vencimento < hojeStr);
  const aVencer = abertas.filter((parcela) => parcela.data_vencimento >= hojeStr);
  const pagasRecentes = [...pagas]
    .sort((a, b) => (b.data_pagamento ?? "").localeCompare(a.data_pagamento ?? ""))
    .slice(0, 12);

  const visibleParcelas = {
    abertas,
    atrasadas,
    pagas,
    todas: filtradasPorBusca,
  }[activeView];
  const visibleClientes =
    activeView === "pagas"
      ? []
      : agruparPorCliente(
          activeView === "todas" ? abertas : visibleParcelas,
          hojeStr
        );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-950 sm:text-2xl">
              Controle de Empréstimos
            </h1>
            <p className="text-sm font-medium text-gray-500">
              {userEmail} • {abertas.length} em aberto • {atrasadas.length} atrasada(s)
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <NovoEmprestimoModal />
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {fetchError ? (
          <div className="border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            Erro ao carregar dados: {fetchError}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Total a receber"
            value={formatCurrency(sumSaldoRestante(abertas))}
            tone="blue"
          />
          <SummaryCard
            label="Atrasado"
            value={formatCurrency(sumSaldoRestante(atrasadas))}
            tone="red"
          />
          <SummaryCard
            label="A vencer"
            value={formatCurrency(sumSaldoRestante(aVencer))}
            tone="green"
          />
          <SummaryCard
            label="Recebido"
            value={formatCurrency(sumValorPago(filtradasPorBusca))}
            tone="gray"
          />
        </section>

        <section className="space-y-3 border border-gray-200 bg-white p-4 shadow-sm">
          <form className="flex flex-col gap-3 md:flex-row" action="/">
            <input type="hidden" name="view" value={activeView} />
            <label className="sr-only" htmlFor="search-client">
              Buscar cliente
            </label>
            <input
              id="search-client"
              name="q"
              defaultValue={q}
              placeholder="Buscar por cliente"
              className="min-h-11 flex-1 border border-gray-300 px-3 text-sm font-medium outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            />
            <button className="min-h-11 border border-blue-700 bg-blue-700 px-5 text-sm font-bold text-white hover:bg-blue-800">
              Buscar
            </button>
          </form>

          <div className="flex flex-wrap gap-2">
            <FilterLink view="abertas" activeView={activeView} q={q} count={abertas.length} />
            <FilterLink
              view="atrasadas"
              activeView={activeView}
              q={q}
              count={atrasadas.length}
            />
            <FilterLink view="pagas" activeView={activeView} q={q} count={pagas.length} />
            <FilterLink
              view="todas"
              activeView={activeView}
              q={q}
              count={filtradasPorBusca.length}
            />
          </div>
        </section>

        {activeView === "pagas" ? (
          <ParcelasSection
            title={viewLabels[activeView]}
            parcelas={visibleParcelas}
            hoje={hoje}
            hojeStr={hojeStr}
          />
        ) : (
          <ClientesSection title={viewLabels[activeView]} clientes={visibleClientes} />
        )}

        {activeView !== "pagas" && pagasRecentes.length > 0 ? (
          <ParcelasSection
            title="Pagas recentemente"
            parcelas={pagasRecentes}
            hoje={hoje}
            hojeStr={hojeStr}
          />
        ) : null}
      </div>
    </main>
  );
}
