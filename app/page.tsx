import nextDynamic from "next/dynamic";
import { addDays, calcularJurosAtraso, diasAtraso, formatDateOnly } from "@/lib/loan-utils";
import { fetchAllRows } from "@/lib/pagination";
import type { PeriodicidadeVencimento, TipoJurosAtraso } from "@/lib/loan-utils";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AuthPanel, SignOutButton } from "./components/AuthPanel";
import { NovoEmprestimoModal } from "./components/NovoEmprestimoModal";
import { MarcarPagoButton } from "./components/MarcarPagoButton";
import { RegistrarPagamentoForm } from "./components/RegistrarPagamentoForm";
import { ContatoCobrancaForm } from "./components/ContatoCobrancaForm";
import { ArquivarCobrancaButton } from "./components/ArquivarCobrancaButton";
import { RestaurarCobrancaButton } from "./components/RestaurarCobrancaButton";
import { atualizarCliente } from "./actions";

const AccountSettingsPanel = nextDynamic(
  () => import("./components/AccountSettingsPanel").then((module) => module.AccountSettingsPanel),
  { loading: () => <div role="status" className="border border-gray-200 bg-white p-4 text-sm text-gray-500">Carregando configurações…</div> },
);
const MfaPanel = nextDynamic(
  () => import("./components/MfaPanel").then((module) => module.MfaPanel),
  { loading: () => <p role="status" className="text-sm text-gray-500">Carregando verificação…</p> },
);

export const dynamic = "force-dynamic";

type ParcelaStatus = "Pendente" | "Pago" | string;
type ViewFilter = "abertas" | "atrasadas" | "pagas" | "todas" | "lembretes" | "financeiro" | "historico" | "lixeira" | "configuracoes";

type ParcelaComCliente = {
  id: string;
  numero: number;
  valor: number;
  valor_pago: number | null;
  valor_juros_atraso_pago: number | null;
  data_vencimento: string;
  data_pagamento: string | null;
  status: ParcelaStatus;
  emprestimo_id: string;
  emprestimos: {
    id: string;
    descricao: string | null;
    periodicidade_vencimento: PeriodicidadeVencimento | null;
    intervalo_personalizado_dias: number | null;
    juros_atraso_tipo: TipoJurosAtraso | null;
    juros_atraso_valor: number | null;
    clientes: ClienteCadastro | null;
  } | null;
};

type ClienteCadastro = {
  id: string;
  nome: string;
  endereco: string | null;
  telefone: string | null;
  cpf: string | null;
};

type ClienteResumo = {
  clienteId: string;
  nome: string;
  cadastro: ClienteCadastro;
  parcelas: ParcelaComCliente[];
  parcelasVisiveis: ParcelaComCliente[];
  proximaParcela: ParcelaComCliente | null;
  totalRestante: number;
  totalAtrasado: number;
  atrasadas: number;
  proximoVencimento: string | null;
};

type PagamentoResumo = {
  id: string;
  cliente_id: string;
  valor_total: number;
  recebido_em: string;
  tipo: "recebimento" | "estorno";
  referencia_pagamento_id: string | null;
  clientes: Pick<ClienteCadastro, "id" | "nome" | "telefone" | "cpf"> | null;
  pagamento_itens: { valor_principal: number; valor_juros: number; parcelas: { numero: number } | null }[];
};

type ContatoResumo = { id: string; parcela_id: string; canal: string; observacao: string; realizado_em: string };

type CobrancaArquivada = {
  id: string;
  descricao: string | null;
  created_at?: string;
  deleted_at: string;
  clientes: ClienteCadastro | null;
  parcelas: { numero: number; valor: number; status: string; data_vencimento: string }[];
};

type PageProps = {
  searchParams?: Promise<{
    q?: string;
    view?: string;
    mes?: string;
  }>;
};

const viewLabels: Record<ViewFilter, string> = {
  abertas: "Em aberto",
  atrasadas: "Atrasadas",
  pagas: "Pagas",
  todas: "Todas",
  lembretes: "Lembretes",
  financeiro: "Financeiro",
  historico: "Histórico de pagamentos",
  lixeira: "Lixeira",
  configuracoes: "Configurações",
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

function formatCpf(cpf: string | null) {
  const digits = (cpf ?? "").replace(/\D/g, "");

  if (digits.length !== 11) {
    return cpf ?? "";
  }

  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function getClienteCadastro(parcela: ParcelaComCliente): ClienteCadastro {
  const cliente = parcela.emprestimos?.clientes;

  return {
    id: cliente?.id ?? `sem-cliente:${getNomeCliente(parcela)}`,
    nome: cliente?.nome ?? "Cliente sem nome",
    endereco: cliente?.endereco ?? "",
    telefone: cliente?.telefone ?? "",
    cpf: cliente?.cpf ?? "",
  };
}

function getNomeCliente(parcela: ParcelaComCliente) {
  return parcela.emprestimos?.clientes?.nome ?? "Cliente sem nome";
}

function getClienteId(parcela: ParcelaComCliente) {
  return parcela.emprestimos?.clientes?.id ?? `sem-cliente:${getNomeCliente(parcela)}`;
}

function clienteMatchesQuery(parcela: ParcelaComCliente, query: string) {
  if (!query) {
    return true;
  }

  const cliente = getClienteCadastro(parcela);
  const queryDigits = query.replace(/\D/g, "");
  const searchableText = [
    cliente.nome,
    cliente.endereco ?? "",
    cliente.telefone ?? "",
    cliente.cpf ?? "",
  ]
    .join(" ")
    .toLocaleLowerCase("pt-BR");
  const searchableDigits = `${cliente.telefone ?? ""} ${cliente.cpf ?? ""}`.replace(/\D/g, "");

  return (
    searchableText.includes(query.toLocaleLowerCase("pt-BR")) ||
    (queryDigits.length > 0 && searchableDigits.includes(queryDigits))
  );
}

function getValorPago(parcela: ParcelaComCliente) {
  return Number(parcela.valor_pago ?? 0);
}

function getValorJurosAtrasoPago(parcela: ParcelaComCliente) {
  return Number(parcela.valor_juros_atraso_pago ?? 0);
}

function getSaldoPrincipalParcela(parcela: ParcelaComCliente) {
  return Math.max(Number(parcela.valor) - getValorPago(parcela), 0);
}

function getJurosAtrasoPendente(parcela: ParcelaComCliente, hoje: Date) {
  if (parcela.status === "Pago") {
    return 0;
  }

  const jurosCalculado = calcularJurosAtraso({
    saldoPrincipal: getSaldoPrincipalParcela(parcela),
    dataVencimento: parcela.data_vencimento,
    hoje,
    tipo: parcela.emprestimos?.juros_atraso_tipo ?? "percentual",
    valorDiario: Number(parcela.emprestimos?.juros_atraso_valor ?? 0),
  });

  return Math.max(jurosCalculado - getValorJurosAtrasoPago(parcela), 0);
}

function getSaldoParcela(parcela: ParcelaComCliente, hoje: Date) {
  return getSaldoPrincipalParcela(parcela) + getJurosAtrasoPendente(parcela, hoje);
}

function getPeriodicidadeLabel(parcela: ParcelaComCliente) {
  const periodicidade = parcela.emprestimos?.periodicidade_vencimento ?? "mensal";
  const intervalo = parcela.emprestimos?.intervalo_personalizado_dias;

  if (periodicidade === "personalizado") {
    return intervalo ? `A cada ${intervalo} dias` : "Personalizado";
  }

  return {
    semanal: "Semanal",
    quinzenal: "Quinzenal",
    mensal: "Mensal",
  }[periodicidade];
}

function sumSaldoRestante(parcelas: ParcelaComCliente[], hoje: Date) {
  return parcelas.reduce((total, parcela) => total + getSaldoParcela(parcela, hoje), 0);
}

function sumValorPago(parcelas: ParcelaComCliente[]) {
  return parcelas.reduce((total, parcela) => total + getValorPago(parcela) + getValorJurosAtrasoPago(parcela), 0);
}

function agruparPorCliente({
  todasParcelas,
  parcelasVisiveis,
  hoje,
  hojeStr,
}: {
  todasParcelas: ParcelaComCliente[];
  parcelasVisiveis: ParcelaComCliente[];
  hoje: Date;
  hojeStr: string;
}) {
  const grupos = new Map<string, ParcelaComCliente[]>();
  const visiveisPorCliente = new Map<string, ParcelaComCliente[]>();

  for (const parcela of todasParcelas) {
    const clienteId = getClienteId(parcela);
    const existentes = grupos.get(clienteId) ?? [];
    existentes.push(parcela);
    grupos.set(clienteId, existentes);
  }

  for (const parcela of parcelasVisiveis) {
    const clienteId = getClienteId(parcela);
    const existentes = visiveisPorCliente.get(clienteId) ?? [];
    existentes.push(parcela);
    visiveisPorCliente.set(clienteId, existentes);
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
        cadastro: getClienteCadastro(parcelasDoCliente[0]),
        parcelas: abertas,
        parcelasVisiveis: visiveisPorCliente.get(clienteId) ?? [],
        proximaParcela: proximas[0] ?? null,
        totalRestante: sumSaldoRestante(abertas, hoje),
        totalAtrasado: sumSaldoRestante(atrasadas, hoje),
        atrasadas: atrasadas.length,
        proximoVencimento: proximas[0]?.data_vencimento ?? null,
      };
    })
    .filter((cliente) => cliente.parcelasVisiveis.length > 0)
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
  if (value === "atrasadas" || value === "pagas" || value === "todas" || value === "lembretes" || value === "financeiro" || value === "historico" || value === "lixeira" || value === "configuracoes") {
    return value;
  }

  return "abertas";
}

function buildHref({
  view,
  q,
  mes,
}: {
  view: ViewFilter;
  q: string;
  mes?: string;
}) {
  const params = new URLSearchParams();
  params.set("view", view);

  if (q) {
    params.set("q", q);
  }
  if (mes) params.set("mes", mes);

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
    <div className="summary-card border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function NavIcon({ view }: { view: ViewFilter }) {
  const paths: Record<ViewFilter, React.ReactNode> = {
    abertas: <><path d="M7 3.75h7l4.25 4.3v11.2a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1V4.75a1 1 0 0 1 1-1Z" /><path d="M14 3.9v4.4h4.2M8.5 12h6M8.5 15.5h6" /></>,
    atrasadas: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
    pagas: <><path d="M5 4.5h14v15H5z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    todas: <><path d="M5 5.5h14M5 12h14M5 18.5h14" /><circle cx="8" cy="5.5" r="1" /><circle cx="13" cy="12" r="1" /><circle cx="10" cy="18.5" r="1" /></>,
    lembretes: <><path d="M18 9a6 6 0 0 0-12 0c0 7-2.5 7-2.5 8.5h17C20.5 16 18 16 18 9ZM10 21h4" /></>,
    financeiro: <><path d="M5 19V10M10 19V5M15 19v-7M20 19V8" /><path d="M3 19.5h18" /></>,
    historico: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
    lixeira: <><path d="M4 7h16M9 7V4.5h6V7m3 0-.8 13h-10L6.4 7M10 10v6m4-6v6" /></>,
    configuracoes: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.4-1.1-1.5-2.6-1.7.6a7.8 7.8 0 0 0-2.6-1.5L14.7 4h-3.1l-.3 1.9a7.8 7.8 0 0 0-2.6 1.5L7 6.8 5.5 9.4 7 10.5a7.7 7.7 0 0 0 0 3l-1.5 1.1L7 17.2l1.7-.6a7.8 7.8 0 0 0 2.6 1.5l.3 1.9h3.1l.3-1.9a7.8 7.8 0 0 0 2.6-1.5l1.7.6 1.5-2.6-1.4-1.1Z" /></>,
  };

  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-[18px] shrink-0">{paths[view]}</svg>;
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
      href={buildHref({ view, q })}
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

function AccessPending({ email, status }: { email: string; status: string }) {
  const blocked = status === "blocked";

  return (
    <main className="auth-shell">
      <section className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-soft">
        <h1 className="text-2xl font-bold text-gray-950">
          {blocked ? "Acesso bloqueado" : "Aguardando aprovação"}
        </h1>
        <p className="mt-3 text-sm font-medium text-gray-600">
          {blocked
            ? "Seu usuário não está liberado para acessar este sistema."
            : "Seu cadastro foi recebido, mas precisa ser autorizado pelo administrador."}
        </p>
        <p className="mt-4 border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-700">
          {email}
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}

function AtrasoResumo({
  valorParcela,
  dias,
  juros,
  total,
  compact = false,
}: {
  valorParcela: number;
  dias: number;
  juros: number;
  total: number;
  compact?: boolean;
}) {
  const itemClass = compact
    ? "flex items-center justify-between gap-3"
    : "flex items-center justify-between gap-3 border-b border-red-100 pb-1";

  return (
    <div className="space-y-1 border-l-4 border-red-600 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
      <div className={itemClass}>
        <span>Valor da parcela</span>
        <strong>{formatCurrency(valorParcela)}</strong>
      </div>
      <div className={itemClass}>
        <span>Dias em atraso</span>
        <strong>{dias}</strong>
      </div>
      <div className={itemClass}>
        <span>Valor de juro</span>
        <strong>{formatCurrency(juros)}</strong>
      </div>
      <div className="flex items-center justify-between gap-3 pt-1 text-sm text-red-950">
        <span>Valor total</span>
        <strong>{formatCurrency(total)}</strong>
      </div>
    </div>
  );
}

function ParcelaCard({
  parcela,
  hoje,
  hojeStr,
  canWrite,
}: {
  parcela: ParcelaComCliente;
  hoje: Date;
  hojeStr: string;
  canWrite: boolean;
}) {
  const nomeCliente = getNomeCliente(parcela);
  const isPaga = parcela.status === "Pago";
  const isAtrasada = !isPaga && parcela.data_vencimento < hojeStr;
  const atraso = diasAtraso(parcela.data_vencimento, hoje);
  const saldo = getSaldoParcela(parcela, hoje);
  const saldoPrincipal = getSaldoPrincipalParcela(parcela);
  const jurosAtraso = getJurosAtrasoPendente(parcela, hoje);
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
              Cobrança {parcela.numero}{parcela.emprestimos?.descricao ? ` • ${parcela.emprestimos.descricao}` : ""}
            </p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {getPeriodicidadeLabel(parcela)}
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
          <AtrasoResumo
            valorParcela={saldoPrincipal}
            dias={atraso}
            juros={jurosAtraso}
            total={saldo}
          />
        ) : null}

        {isPaga && parcela.data_pagamento ? (
          <p className="border-l-4 border-emerald-600 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
            Pago em {formatDate(parcela.data_pagamento)}
          </p>
        ) : null}
      </div>

      <MarcarPagoButton parcelaId={parcela.id} status={parcela.status} canWrite={canWrite} />
    </article>
  );
}

function ParcelasDoCliente({
  parcelas,
  hoje,
  hojeStr,
  canWrite,
}: {
  parcelas: ParcelaComCliente[];
  hoje: Date;
  hojeStr: string;
  canWrite: boolean;
}) {
  return (
    <>
      <div className="hidden overflow-hidden border border-gray-200 bg-white md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-gray-100 text-xs font-bold uppercase tracking-wide text-gray-600">
            <tr>
              <th className="px-4 py-3">Parcela</th>
              <th className="px-4 py-3">Vencimento</th>
              <th className="px-4 py-3">Periodicidade</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-right">Pago</th>
              <th className="px-4 py-3 text-right">Falta</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {parcelas.map((parcela) => {
              const saldo = getSaldoParcela(parcela, hoje);
              const saldoPrincipal = getSaldoPrincipalParcela(parcela);
              const valorPago = getValorPago(parcela);
              const jurosAtraso = getJurosAtrasoPendente(parcela, hoje);
              const atraso = diasAtraso(parcela.data_vencimento, hoje);
              const isPaga = parcela.status === "Pago";
              const isAtrasada = !isPaga && parcela.data_vencimento < hojeStr;

              return (
                <tr key={parcela.id} className="bg-white align-top hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700">
                    {parcela.numero}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    {formatDate(parcela.data_vencimento)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {getPeriodicidadeLabel(parcela)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {formatCurrency(parcela.valor)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                    {formatCurrency(valorPago)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-blue-900">
                    {formatCurrency(saldo)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        isPaga
                          ? "font-bold text-emerald-700"
                          : isAtrasada
                            ? "font-bold text-red-700"
                            : "font-bold text-blue-700"
                      }
                    >
                      {isPaga ? "Pago" : isAtrasada ? "Atrasada" : "A vencer"}
                    </span>
                    {isAtrasada ? (
                      <div className="mt-2 min-w-48">
                        <AtrasoResumo
                          valorParcela={saldoPrincipal}
                          dias={atraso}
                          juros={jurosAtraso}
                          total={saldo}
                          compact
                        />
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <MarcarPagoButton parcelaId={parcela.id} status={parcela.status} canWrite={canWrite} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-4 md:hidden">
        {parcelas.map((parcela) => (
          <ParcelaCard
            key={parcela.id}
            parcela={parcela}
            hoje={hoje}
            hojeStr={hojeStr}
            canWrite={canWrite}
          />
        ))}
      </div>
    </>
  );
}

function ClienteCard({
  cliente,
  hoje,
  hojeStr,
  canWrite,
}: {
  cliente: ClienteResumo;
  hoje: Date;
  hojeStr: string;
  canWrite: boolean;
}) {
  const proximaParcela = cliente.proximaParcela;
  const cadastro = cliente.cadastro;

  return (
    <details className="group border border-gray-200 bg-white shadow-sm">
      <summary className="grid cursor-pointer list-none gap-4 p-5 marker:hidden lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="truncate text-xl font-bold text-gray-950">{cliente.nome}</h3>
              <p className="mt-1 text-sm font-medium text-gray-600">
                {cliente.parcelas.length} cobrança(s) em aberto •{" "}
                {cliente.parcelasVisiveis.length} nesta visão
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-gray-500">
                {cadastro.telefone ? <span>Telefone: {cadastro.telefone}</span> : null}
                {cadastro.cpf ? <span>CPF: {formatCpf(cadastro.cpf)}</span> : null}
              </div>
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
        </div>

        <span className="border border-gray-300 px-4 py-2 text-center text-sm font-bold text-gray-700 group-open:bg-gray-950 group-open:text-white">
          Ver parcelas
        </span>
      </summary>

      <div className="border-t border-gray-200 p-5 pt-4">
        {canWrite ? <form action={atualizarCliente} className="mb-5 space-y-3 border border-gray-200 bg-gray-50 p-4">
          <input type="hidden" name="cliente_id" value={cliente.clienteId} />
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h4 className="text-sm font-bold text-gray-950">Dados do cliente</h4>
            <button className="min-h-9 border border-gray-950 bg-gray-950 px-4 text-sm font-bold text-white hover:bg-gray-800">
              Salvar dados
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
                Nome
              </label>
              <input
                name="nome"
                required
                maxLength={120}
                defaultValue={cadastro.nome}
                className="mt-1 min-h-10 w-full border border-gray-300 bg-white px-3 text-sm font-semibold outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
                CPF
              </label>
              <input
                name="cpf"
                required
                inputMode="numeric"
                maxLength={14}
                defaultValue={formatCpf(cadastro.cpf)}
                className="mt-1 min-h-10 w-full border border-gray-300 bg-white px-3 text-sm font-semibold outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
                Telefone
              </label>
              <input
                name="telefone"
                inputMode="tel"
                maxLength={20}
                defaultValue={cadastro.telefone ?? ""}
                className="mt-1 min-h-10 w-full border border-gray-300 bg-white px-3 text-sm font-semibold outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
                Endereço
              </label>
              <input
                name="endereco"
                maxLength={240}
                defaultValue={cadastro.endereco ?? ""}
                className="mt-1 min-h-10 w-full border border-gray-300 bg-white px-3 text-sm font-semibold outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
        </form> : <p className="mb-5 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Edição pausada até a assinatura ser regularizada. A consulta e exportação continuam disponíveis.</p>}

        <div className="mb-5 space-y-3 border border-gray-200 p-4">
          <h4 className="text-sm font-bold text-gray-950">Cobranças deste cliente</h4>
          {Array.from(new Map(cliente.parcelasVisiveis.map((parcela) => [parcela.emprestimo_id, parcela])).values()).map((parcela) => (
            <div key={parcela.emprestimo_id} className="flex flex-col justify-between gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:items-center">
              <div><p className="text-sm font-semibold text-gray-800">{parcela.emprestimos?.descricao || "Cobrança"}</p><p className="text-xs text-gray-500">{cliente.parcelasVisiveis.filter((item) => item.emprestimo_id === parcela.emprestimo_id).length} parcela(s) nesta visão</p></div>
              {canWrite ? <ArquivarCobrancaButton emprestimoId={parcela.emprestimo_id} /> : null}
            </div>
          ))}
        </div>

        {proximaParcela ? (
          <div className="mb-5 flex flex-col gap-3 border border-blue-100 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                Próxima cobrança
              </p>
              <p className="mt-1 text-sm font-bold text-blue-950">
                Cobrança {proximaParcela.numero} • falta{" "}
                {formatCurrency(getSaldoParcela(proximaParcela, hoje))} •{" "}
                vence {formatDate(proximaParcela.data_vencimento)}
              </p>
              <p className="mt-1 text-xs font-semibold text-blue-800">
                Vencimento {getPeriodicidadeLabel(proximaParcela)}
              </p>
              {getValorPago(proximaParcela) > 0 ? (
                <p className="mt-1 text-xs font-semibold text-blue-800">
                  Já pago nesta parcela: {formatCurrency(getValorPago(proximaParcela))}
                </p>
              ) : null}
            </div>
            {canWrite ? <div className="w-full sm:max-w-sm">
              <RegistrarPagamentoForm
                clienteId={cliente.clienteId}
                saldoAberto={cliente.totalRestante}
              />
            </div> : null}
          </div>
        ) : null}

        <ParcelasDoCliente
          parcelas={cliente.parcelasVisiveis}
          hoje={hoje}
          hojeStr={hojeStr}
          canWrite={canWrite}
        />
      </div>
    </details>
  );
}

function ClientesSection({
  title,
  clientes,
  hoje,
  hojeStr,
  canWrite,
}: {
  title: string;
  clientes: ClienteResumo[];
  hoje: Date;
  hojeStr: string;
  canWrite: boolean;
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
            <ClienteCard
              key={cliente.clienteId}
              cliente={cliente}
              hoje={hoje}
              hojeStr={hojeStr}
              canWrite={canWrite}
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
  const mesSelecionado = /^\d{4}-\d{2}$/.test(params.mes ?? "") ? params.mes! : formatDateOnly(new Date()).slice(0, 7);
  const normalizedQuery = q.toLocaleLowerCase("pt-BR");
  const activeView = normalizeView(params.view);
  const hoje = new Date();
  const hojeStr = formatDateOnly(hoje);
  let parcelas: ParcelaComCliente[] = [];
  let pagamentos: PagamentoResumo[] = [];
  let contatos: ContatoResumo[] = [];
  let arquivadas: CobrancaArquivada[] = [];
  let arquivadasCount = 0;
  let fetchError: string | null = null;
  let userEmail = "";
  let userFone = "";
  let emailRemindersEnabled = false;
  let canWrite = true;

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return (
        <AuthPanel />
      );
    }

    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw new Error(`Erro ao verificar autenticação: ${assuranceError.message}`);
    if (assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
      return (
        <main className="auth-shell">
          <section className="w-full max-w-md space-y-4 rounded-2xl border border-gray-200 bg-white p-7 shadow-soft">
            <h1 className="text-xl font-bold text-gray-950">Verificação em duas etapas</h1>
            <MfaPanel challengeOnly />
            <SignOutButton />
          </section>
        </main>
      );
    }

    userEmail = user.email ?? "";
    const accessResult = await supabase.rpc("get_own_saas_access");
    if (!accessResult.error) {
      const accessRows = accessResult.data as { can_write?: boolean }[] | null;
      if (accessRows?.length) canWrite = accessRows[0].can_write !== false;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, fone, status, email_reminders_enabled")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw new Error(profileError.message);
    }

    if (!profile || profile.status !== "approved") {
      return (
        <AccessPending
          email={userEmail}
          status={profile?.status ?? "pending"}
        />
      );
    }

    userFone = profile.fone ?? "";
    emailRemindersEnabled = Boolean(profile.email_reminders_enabled);

    if (activeView !== "configuracoes") {
      const needsPayments = activeView === "financeiro" || activeView === "historico";
      const needsContacts = activeView === "lembretes";
      const needsArchivedRows = activeView === "lixeira";

      const parcelasQuery = supabase
        .from("parcelas")
        .select(`
          id, numero, valor, valor_pago, valor_juros_atraso_pago,
          data_vencimento, data_pagamento, status, emprestimo_id,
          emprestimos!inner (
            id, descricao, periodicidade_vencimento, intervalo_personalizado_dias,
            juros_atraso_tipo, juros_atraso_valor,
            clientes!inner (id, nome, endereco, telefone, cpf)
          )
        `)
        .is("emprestimos.deleted_at", null)
        .is("emprestimos.clientes.deleted_at", null)
        .order("data_vencimento", { ascending: true })
        .order("id", { ascending: true });
      const [parcelasResult, pagamentosResult, contatosResult, arquivadasResult, arquivadasCountResult] = await Promise.all([
        fetchAllRows((from, to) => parcelasQuery.range(from, to)),
        needsPayments
          ? fetchAllRows((from, to) => supabase.from("pagamentos").select("id, cliente_id, valor_total, recebido_em, tipo, referencia_pagamento_id, clientes(id, nome, telefone, cpf), pagamento_itens(valor_principal, valor_juros, parcelas(numero))").order("recebido_em", { ascending: false }).order("id", { ascending: true }).range(from, to))
          : Promise.resolve([]),
        needsContacts
          ? fetchAllRows((from, to) => supabase.from("cobranca_contatos").select("id, parcela_id, canal, observacao, realizado_em").order("realizado_em", { ascending: false }).order("id", { ascending: true }).range(from, to))
          : Promise.resolve([]),
        needsArchivedRows
          ? fetchAllRows((from, to) => supabase.from("emprestimos").select("id, descricao, deleted_at, clientes!inner(id, nome, telefone, cpf, endereco), parcelas(numero, valor, status, data_vencimento)").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).order("id", { ascending: true }).range(from, to))
          : Promise.resolve([]),
        !needsArchivedRows
          ? supabase.from("emprestimos").select("id", { count: "exact", head: true }).not("deleted_at", "is", null)
          : Promise.resolve(null),
      ]);
      parcelas = parcelasResult as unknown as ParcelaComCliente[];
      pagamentos = pagamentosResult as unknown as PagamentoResumo[];
      contatos = contatosResult as unknown as ContatoResumo[];
      if (needsArchivedRows) {
        arquivadas = arquivadasResult as unknown as CobrancaArquivada[];
        arquivadasCount = arquivadas.length;
      } else {
        if (arquivadasCountResult?.error) throw new Error(arquivadasCountResult.error.message);
        arquivadasCount = arquivadasCountResult?.count ?? 0;
      }
    }
  } catch (error) {
    fetchError = (error as Error).message;
  }

  const filtradasPorBusca = normalizedQuery
    ? parcelas.filter((parcela) => clienteMatchesQuery(parcela, normalizedQuery))
    : parcelas;

  const pagas = filtradasPorBusca.filter((parcela) => parcela.status === "Pago");
  const abertas = filtradasPorBusca.filter((parcela) => parcela.status !== "Pago");
  const atrasadas = abertas.filter((parcela) => parcela.data_vencimento < hojeStr);
  const aVencer = abertas.filter((parcela) => parcela.data_vencimento >= hojeStr);
  const limiteLembretesStr = addDays(hojeStr, 7);
  const lembretes = abertas.filter((parcela) => parcela.data_vencimento <= limiteLembretesStr);
  const mesInicio = `${mesSelecionado}-01`;
  const [anoMesAno, anoMesMes] = mesSelecionado.split("-").map(Number);
  const mesFim = new Date(Date.UTC(anoMesAno, anoMesMes, 0)).toISOString().slice(0, 10);
  const mesAnteriorDate = new Date(Date.UTC(anoMesAno, anoMesMes - 2, 1));
  const mesAnterior = `${mesAnteriorDate.getUTCFullYear()}-${String(mesAnteriorDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const pagamentosFiltrados = pagamentos.filter((p) => {
    if (!normalizedQuery) return true;
    const client = p.clientes;
    const text = `${client?.nome ?? ""} ${client?.telefone ?? ""} ${client?.cpf ?? ""}`.toLocaleLowerCase("pt-BR");
    const digits = normalizedQuery.replace(/\D/g, "");
    return text.includes(normalizedQuery) || (digits.length > 0 && `${client?.telefone ?? ""} ${client?.cpf ?? ""}`.replace(/\D/g, "").includes(digits));
  });
  const recebimentosDoMes = pagamentosFiltrados.filter((p) => p.recebido_em.startsWith(mesSelecionado));
  const recebimentosMesAnterior = pagamentosFiltrados.filter((p) => p.recebido_em.startsWith(mesAnterior));
  const recebidoMes = recebimentosDoMes.reduce((sum, p) => sum + (p.tipo === "estorno" ? -1 : 1) * Number(p.valor_total), 0);
  const recebidoMesAnterior = recebimentosMesAnterior.reduce((sum, p) => sum + (p.tipo === "estorno" ? -1 : 1) * Number(p.valor_total), 0);
  const cobrancasDoMes = filtradasPorBusca.filter((p) => p.data_vencimento >= mesInicio && p.data_vencimento <= mesFim);
  const historicoFiltrado = pagamentosFiltrados;

  const visibleParcelas = ({
    abertas,
    atrasadas,
    pagas,
    todas: filtradasPorBusca,
  } as Partial<Record<ViewFilter, ParcelaComCliente[]>>)[activeView] ?? filtradasPorBusca;
  const visibleClientes = agruparPorCliente({
    todasParcelas: filtradasPorBusca,
    parcelasVisiveis: visibleParcelas,
    hoje,
    hojeStr,
  });
  const primaryNavigation: { view: ViewFilter; label: string; count?: number }[] = [
    { view: "abertas", label: "Em aberto" },
    { view: "lembretes", label: "Lembretes", count: lembretes.length },
    { view: "financeiro", label: "Financeiro" },
    { view: "historico", label: "Histórico de pagamentos" },
    { view: "lixeira", label: "Lixeira", count: arquivadasCount },
    { view: "configuracoes", label: "Configurações" },
  ];

  return (
    <main className="app-shell">
      <header className="app-header sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-950 sm:text-2xl">
              Recebify • Gestão de cobranças
            </h1>
            <p className="text-sm font-medium text-gray-500">
              {activeView === "configuracoes" ? userEmail : `${userEmail} • ${abertas.length} em aberto • ${atrasadas.length} atrasada(s)`}
            </p>
          </div>
          <div className="header-actions flex items-center gap-2">
            <NovoEmprestimoModal canWrite={canWrite} />
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="app-layout mx-auto flex max-w-7xl items-start gap-6 px-4 py-6">
        <aside className="app-sidebar sticky top-24 hidden w-60 shrink-0 md:block" aria-label="Menu lateral">
          <nav aria-label="Áreas do sistema" className="border border-gray-200 bg-white p-3 shadow-sm">
            <p className="mb-3 px-3 text-xs font-bold uppercase tracking-wide text-gray-500">Menu</p>
            <div className="space-y-1">
              {primaryNavigation.map(({ view, label, count }) => (
                <a key={view} href={buildHref({ view, q, mes: view === "financeiro" ? mesSelecionado : undefined })}
                  aria-current={activeView === view ? "page" : undefined}
                  className={`flex min-h-11 items-center justify-between border-l-4 px-3 py-2 text-sm font-semibold transition-colors ${activeView === view ? "border-blue-700 bg-blue-50 text-blue-800" : "border-transparent text-gray-700 hover:bg-gray-50 hover:text-gray-950"}`}>
                  <span className="flex min-w-0 items-center gap-3"><NavIcon view={view} /><span className="truncate">{label}</span></span>
                  {count !== undefined ? <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${activeView === view ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600"}`}>{count}</span> : null}
                </a>
              ))}
            </div>
            {activeView !== "configuracoes" ? <div className="mt-4 space-y-1 border-t border-gray-200 pt-3">
              <p className="mb-2 px-3 text-xs font-bold uppercase tracking-wide text-gray-500">Exportar e backup</p>
              <a href="/api/export" className="flex min-h-10 items-center px-3 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-950">Cobranças CSV</a>
              <a href="/api/export?tipo=pagamentos" className="flex min-h-10 items-center px-3 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-950">Pagamentos CSV</a>
              <a href="/api/export?formato=json" className="flex min-h-10 items-center px-3 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-950">Backup JSON</a>
            </div> : null}
          </nav>
        </aside>

        <div className="app-content min-w-0 flex-1 space-y-6">
          {!canWrite ? <div role="status" className="border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">Seu período de avaliação terminou. Seus dados continuam disponíveis para consulta e exportação; assine um plano em <a className="font-bold underline" href={buildHref({ view: "configuracoes", q })}>Configurações</a> para voltar a cadastrar, editar e registrar pagamentos.</div> : null}
          <nav aria-label="Áreas do sistema" className="app-mobile-nav flex gap-2 overflow-x-auto border border-gray-200 bg-white p-2 md:hidden">
            {primaryNavigation.map(({ view, label, count }) => (
              <a key={view} href={buildHref({ view, q, mes: view === "financeiro" ? mesSelecionado : undefined })}
                aria-current={activeView === view ? "page" : undefined}
                className={`min-h-10 shrink-0 px-3 py-2 text-sm font-bold ${activeView === view ? "bg-blue-700 text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
                <span className="flex items-center gap-2"><NavIcon view={view} />{label}{count !== undefined ? ` (${count})` : ""}</span>
              </a>
            ))}
          </nav>
          {activeView !== "configuracoes" ? <details className="border border-gray-200 bg-white p-3 text-sm md:hidden">
            <summary className="cursor-pointer font-semibold text-gray-700">Exportar e backup</summary>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href="/api/export" className="border border-gray-300 px-3 py-2 font-medium text-gray-700">Cobranças CSV</a>
              <a href="/api/export?tipo=pagamentos" className="border border-gray-300 px-3 py-2 font-medium text-gray-700">Pagamentos CSV</a>
              <a href="/api/export?formato=json" className="border border-gray-300 px-3 py-2 font-medium text-gray-700">Backup JSON</a>
            </div>
          </details> : null}

        {fetchError ? (
          <div className="border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            Erro ao carregar dados: {fetchError}
          </div>
        ) : null}

        {activeView !== "configuracoes" ? <section className="summary-grid grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Total a receber"
            value={formatCurrency(sumSaldoRestante(abertas, hoje))}
            tone="blue"
          />
          <SummaryCard
            label="Atrasado"
            value={formatCurrency(sumSaldoRestante(atrasadas, hoje))}
            tone="red"
          />
          <SummaryCard
            label="A vencer"
            value={formatCurrency(sumSaldoRestante(aVencer, hoje))}
            tone="green"
          />
          <SummaryCard
            label="Recebido"
            value={formatCurrency(sumValorPago(filtradasPorBusca))}
            tone="gray"
          />
        </section> : null}

        {activeView === "configuracoes" ? (
          <section className="space-y-5" aria-labelledby="settings-title">
            <header className="content-panel border border-gray-200 bg-white p-6 shadow-sm">
              <h2 id="settings-title" className="text-xl font-bold text-gray-950">Configurações</h2>
              <p className="mt-1 text-sm text-gray-600">Gerencie seus dados, recebimentos, plano, segurança e backups em um só lugar.</p>
              <nav aria-label="Seções de configurações" className="settings-anchor-nav mt-4 flex flex-wrap gap-2">
                {[
                  ["#dados-da-conta", "Conta"],
                  ["#assinatura", "Plano"],
                  ["#seguranca", "Segurança"],
                  ["#backup", "Backup"],
                ].map(([href, label]) => (
                  <a key={href} href={href} className="min-h-9 border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:border-blue-700 hover:text-blue-700">{label}</a>
                ))}
              </nav>
            </header>
            <AccountSettingsPanel email={userEmail} fone={userFone} emailRemindersEnabled={emailRemindersEnabled} canWrite={canWrite} />
          </section>
        ) : null}

        {activeView === "financeiro" ? (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 border border-gray-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
              <div><h2 className="text-lg font-bold text-gray-950">Resumo financeiro</h2><p className="text-sm text-gray-600">Entradas usam a data real do pagamento. O histórico mensal detalhado começa após a migração.</p></div>
              <form action="/" className="flex items-end gap-2"><input type="hidden" name="view" value="financeiro" /><label className="text-xs font-bold text-gray-600">Período<input name="mes" type="month" defaultValue={mesSelecionado} className="mt-1 block min-h-10 border border-gray-300 px-3 text-sm" /></label><button className="min-h-10 bg-blue-700 px-4 text-sm font-bold text-white">Aplicar</button></form>
            </div>
            <div className="summary-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Recebido no mês" value={formatCurrency(recebidoMes)} tone="green" />
              <SummaryCard label="Recebido no mês anterior" value={formatCurrency(recebidoMesAnterior)} tone="gray" />
              <SummaryCard label="Em aberto com vencimento no mês" value={formatCurrency(sumSaldoRestante(cobrancasDoMes.filter((p) => p.status !== "Pago"), hoje))} tone="blue" />
              <SummaryCard label="Atrasado agora" value={formatCurrency(sumSaldoRestante(atrasadas, hoje))} tone="red" />
            </div>
            <p className="border border-gray-200 bg-white p-4 text-sm text-gray-600">
              {recebidoMesAnterior > 0 ? `Variação de recebimentos: ${((recebidoMes - recebidoMesAnterior) / recebidoMesAnterior * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% em relação ao mês anterior.` : recebidoMes > 0 ? "Não há recebimentos registrados no mês anterior para comparação." : "Nenhum recebimento registrado neste mês."}
            </p>
          </section>
        ) : null}

        {activeView === "lembretes" ? (
          <section className="space-y-3">
            <div><h2 className="text-lg font-bold text-gray-950">Atenção para hoje e próximos 7 dias</h2><p className="text-sm text-gray-600">Sem envio automático: registre quando fizer um contato manualmente.</p></div>
            {lembretes.length === 0 ? <div className="border border-gray-200 bg-white p-6 text-sm text-gray-600">Nenhuma cobrança vencida ou próxima do vencimento.</div> : lembretes.map((parcela) => {
              const historicoContato = contatos.filter((item) => item.parcela_id === parcela.id).slice(0, 3);
              return <article key={parcela.id} className="space-y-3 border border-gray-200 bg-white p-4">
                <div className="flex flex-col justify-between gap-2 sm:flex-row"><div><h3 className="font-bold text-gray-950">{getNomeCliente(parcela)} · parcela {parcela.numero}</h3><p className="text-sm text-gray-600">Vencimento {formatDate(parcela.data_vencimento)} · {parcela.data_vencimento < hojeStr ? `${diasAtraso(parcela.data_vencimento, hoje)} dia(s) de atraso` : parcela.data_vencimento === hojeStr ? "vence hoje" : "próximos 7 dias"}</p></div><p className="font-bold text-red-700">{formatCurrency(getSaldoParcela(parcela, hoje))}</p></div>
                {historicoContato.length ? <ul className="space-y-1 text-xs text-gray-500">{historicoContato.map((item) => <li key={item.id}>{new Date(item.realizado_em).toLocaleString("pt-BR")} · {item.canal}{item.observacao ? ` · ${item.observacao}` : ""}</li>)}</ul> : <p className="text-xs text-gray-500">Nenhum contato registrado.</p>}
                {canWrite ? <ContatoCobrancaForm parcelaId={parcela.id} /> : null}
              </article>;
            })}
          </section>
        ) : null}

        {activeView === "historico" ? (
          <section className="space-y-3">
            <div><h2 className="text-lg font-bold text-gray-950">Histórico de pagamentos</h2><p className="text-sm text-gray-600">Pagamentos e rateios registrados a partir da ativação do histórico.</p></div>
            <form action="/" className="flex gap-2 border border-gray-200 bg-white p-3"><input type="hidden" name="view" value="historico" /><input name="q" defaultValue={q} placeholder="Filtrar cliente, CPF ou telefone" className="min-h-10 flex-1 border border-gray-300 px-3 text-sm" /><button className="bg-blue-700 px-4 text-sm font-bold text-white">Buscar</button></form>
            {historicoFiltrado.length === 0 ? <div className="border border-gray-200 bg-white p-6 text-sm text-gray-600">Ainda não há pagamentos registrados para exibir.</div> : historicoFiltrado.map((pagamento) => {
              return <article key={pagamento.id} className="border border-gray-200 bg-white p-4">
                <div className="flex justify-between gap-3"><div><h3 className="font-bold text-gray-950">{pagamento.tipo === "estorno" ? "Estorno · " : ""}{pagamento.clientes?.nome ?? "Cliente arquivado"}</h3><p className="text-sm text-gray-500">{pagamento.tipo === "estorno" ? "Estornado em " : "Recebido em "}{formatDate(pagamento.recebido_em)}</p></div><strong className={pagamento.tipo === "estorno" ? "text-red-700" : "text-emerald-700"}>{pagamento.tipo === "estorno" ? "−" : "+"}{formatCurrency(Number(pagamento.valor_total))}</strong></div>
                <ul className="mt-3 space-y-1 text-xs text-gray-600">{pagamento.pagamento_itens.map((item, index) => <li key={`${pagamento.id}-${index}`}>{pagamento.tipo === "estorno" ? "Estorno da parcela" : `Parcela ${item.parcelas?.numero ?? "—"}`}: principal {formatCurrency(Number(item.valor_principal))} + juros {formatCurrency(Number(item.valor_juros))}</li>)}</ul>
              </article>;
            })}
          </section>
        ) : null}

        {activeView === "lixeira" ? (
          <section className="space-y-3"><div><h2 className="text-lg font-bold text-gray-950">Cobranças arquivadas</h2><p className="text-sm text-gray-600">Arquivar não apaga dados nem altera pagamentos; restaurar traz a cobrança de volta aos totais.</p></div>
            {arquivadas.length === 0 ? <div className="border border-gray-200 bg-white p-6 text-sm text-gray-600">A lixeira está vazia.</div> : arquivadas.map((item) => { const cliente = Array.isArray(item.clientes) ? item.clientes[0] : item.clientes; return <article key={item.id} className="flex flex-col justify-between gap-4 border border-gray-200 bg-white p-4 sm:flex-row sm:items-center"><div><h3 className="font-bold text-gray-950">{cliente?.nome ?? "Cliente"} · {item.descricao || "Cobrança"}</h3><p className="text-sm text-gray-500">Arquivada em {new Date(item.deleted_at).toLocaleDateString("pt-BR")} · {item.parcelas?.length ?? 0} parcelas</p></div>{canWrite ? <RestaurarCobrancaButton emprestimoId={item.id} /> : null}</article>; })}
          </section>
        ) : null}

        {(["abertas", "atrasadas", "pagas", "todas"].includes(activeView)) ? <section className="space-y-3 border border-gray-200 bg-white p-4 shadow-sm">
          <form className="flex flex-col gap-3 md:flex-row" action="/">
            <input type="hidden" name="view" value={activeView} />
            <label className="sr-only" htmlFor="search-client">
              Buscar cliente
            </label>
            <input
              id="search-client"
              name="q"
              defaultValue={q}
              placeholder="Buscar por nome, CPF, telefone ou endereço"
              className="min-h-11 flex-1 border border-gray-300 px-3 text-sm font-medium outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            />
            <button className="min-h-11 border border-blue-700 bg-blue-700 px-5 text-sm font-bold text-white hover:bg-blue-800">
              Buscar
            </button>
          </form>

          <div className="flex flex-wrap gap-2">
            <FilterLink
              view="abertas"
              activeView={activeView}
              q={q}
              count={abertas.length}
            />
            <FilterLink
              view="atrasadas"
              activeView={activeView}
              q={q}
              count={atrasadas.length}
            />
            <FilterLink
              view="pagas"
              activeView={activeView}
              q={q}
              count={pagas.length}
            />
            <FilterLink
              view="todas"
              activeView={activeView}
              q={q}
              count={filtradasPorBusca.length}
            />
          </div>
        </section> : null}

        {(["abertas", "atrasadas", "pagas", "todas"].includes(activeView)) ? <ClientesSection
          title={viewLabels[activeView]}
          clientes={visibleClientes}
          hoje={hoje}
          hojeStr={hojeStr}
          canWrite={canWrite}
        /> : null}
        </div>
      </div>
    </main>
  );
}
