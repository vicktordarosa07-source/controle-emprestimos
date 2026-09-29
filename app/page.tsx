import nextDynamic from "next/dynamic";
import { calcularJurosAtraso, diasAtraso, formatDateOnly } from "@/lib/loan-utils";
import type { PeriodicidadeVencimento, TipoJurosAtraso } from "@/lib/loan-utils";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AuthPanel, SignOutButton } from "./components/AuthPanel";
import { NovoEmprestimoModal } from "./components/NovoEmprestimoModal";
import { MarcarPagoButton } from "./components/MarcarPagoButton";
import { RegistrarPagamentoForm } from "./components/RegistrarPagamentoForm";
import { ContatoCobrancaForm } from "./components/ContatoCobrancaForm";
import { ArquivarCobrancaButton } from "./components/ArquivarCobrancaButton";
import { RestaurarCobrancaButton } from "./components/RestaurarCobrancaButton";
import { AsaasChargeButton } from "./components/AsaasChargeButton";
import { aprovarUsuario, atualizarCliente } from "./actions";

const AccountSettingsPanel = nextDynamic(
  () => import("./components/AccountSettingsPanel").then((module) => module.AccountSettingsPanel),
  { loading: () => <div role="status" className="border border-gray-200 bg-white p-4 text-sm text-gray-500">Carregando configurações…</div> },
);
const MfaPanel = nextDynamic(
  () => import("./components/MfaPanel").then((module) => module.MfaPanel),
  { loading: () => <p role="status" className="text-sm text-gray-500">Carregando verificação…</p> },
);
const AsaasSettingsPanel = nextDynamic(
  () => import("./components/AsaasSettingsPanel").then((module) => module.AsaasSettingsPanel),
  { loading: () => <div role="status" className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Carregando integração…</div> },
);

export const dynamic = "force-dynamic";

type ParcelaStatus = "Pendente" | "Pago" | string;
type ViewFilter = "abertas" | "atrasadas" | "pagas" | "todas" | "lembretes" | "financeiro" | "historico" | "lixeira" | "integracoes" | "configuracoes";

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

type UserProfile = {
  id: string;
  email: string;
  fone: string;
  status: "pending" | "approved" | "blocked" | string;
  is_admin: boolean;
  created_at: string;
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
  integracoes: "Integrações",
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
  if (value === "atrasadas" || value === "pagas" || value === "todas" || value === "lembretes" || value === "financeiro" || value === "historico" || value === "lixeira" || value === "integracoes" || value === "configuracoes") {
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
    <main className="grid min-h-screen place-items-center bg-gray-50 px-4">
      <section className="w-full max-w-md border border-gray-200 bg-white p-6 text-center shadow-sm">
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

function AdminApprovalPanel({ pendingUsers }: { pendingUsers: UserProfile[] }) {
  return (
    <section className="space-y-3 border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-bold text-amber-950">Usuários aguardando aprovação</h2>
        <span className="text-sm font-bold text-amber-800">
          {pendingUsers.length} pendente(s)
        </span>
      </div>

      {pendingUsers.length === 0 ? (
        <p className="text-sm font-semibold text-amber-800">
          Nenhum usuário pendente no momento.
        </p>
      ) : (
        <div className="divide-y divide-amber-200 border border-amber-200 bg-white">
          {pendingUsers.map((user) => (
            <div
              key={user.id}
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-gray-950">{user.email}</p>
                <p className="mt-1 text-xs font-semibold text-gray-600">{user.fone}</p>
              </div>
              <form action={aprovarUsuario}>
                <input type="hidden" name="user_id" value={user.id} />
                <button className="min-h-10 w-full border border-emerald-700 bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 sm:w-auto">
                  Aprovar acesso
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </section>
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
}: {
  parcela: ParcelaComCliente;
  hoje: Date;
  hojeStr: string;
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

      <MarcarPagoButton parcelaId={parcela.id} status={parcela.status} />
      {!isPaga ? <AsaasChargeButton parcelaId={parcela.id} /> : null}
    </article>
  );
}

function ParcelasDoCliente({
  parcelas,
  hoje,
  hojeStr,
}: {
  parcelas: ParcelaComCliente[];
  hoje: Date;
  hojeStr: string;
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
                    <MarcarPagoButton parcelaId={parcela.id} status={parcela.status} />
                    {!isPaga ? <AsaasChargeButton parcelaId={parcela.id} /> : null}
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
}: {
  cliente: ClienteResumo;
  hoje: Date;
  hojeStr: string;
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
        <form action={atualizarCliente} className="mb-5 space-y-3 border border-gray-200 bg-gray-50 p-4">
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
        </form>

        <div className="mb-5 space-y-3 border border-gray-200 p-4">
          <h4 className="text-sm font-bold text-gray-950">Cobranças deste cliente</h4>
          {Array.from(new Map(cliente.parcelasVisiveis.map((parcela) => [parcela.emprestimo_id, parcela])).values()).map((parcela) => (
            <div key={parcela.emprestimo_id} className="flex flex-col justify-between gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:items-center">
              <div><p className="text-sm font-semibold text-gray-800">{parcela.emprestimos?.descricao || "Cobrança"}</p><p className="text-xs text-gray-500">{cliente.parcelasVisiveis.filter((item) => item.emprestimo_id === parcela.emprestimo_id).length} parcela(s) nesta visão</p></div>
              <ArquivarCobrancaButton emprestimoId={parcela.emprestimo_id} />
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
            <div className="w-full sm:max-w-sm">
              <RegistrarPagamentoForm
                clienteId={cliente.clienteId}
                saldoAberto={cliente.totalRestante}
              />
            </div>
          </div>
        ) : null}

        <ParcelasDoCliente
          parcelas={cliente.parcelasVisiveis}
          hoje={hoje}
          hojeStr={hojeStr}
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
}: {
  title: string;
  clientes: ClienteResumo[];
  hoje: Date;
  hojeStr: string;
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
  const mesSelecionado = /^\d{4}-\d{2}$/.test(params.mes ?? "") ? params.mes! : new Date().toISOString().slice(0, 7);
  const normalizedQuery = q.toLocaleLowerCase("pt-BR");
  const activeView = normalizeView(params.view);
  const hoje = new Date();
  const hojeStr = formatDateOnly(hoje);
  let parcelas: ParcelaComCliente[] = [];
  let pagamentos: PagamentoResumo[] = [];
  let contatos: ContatoResumo[] = [];
  let arquivadas: CobrancaArquivada[] = [];
  let pendingUsers: UserProfile[] = [];
  let arquivadasCount = 0;
  let fetchError: string | null = null;
  let userEmail = "";
  let userFone = "";
  let emailRemindersEnabled = false;
  let isAdmin = false;

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
        <main className="grid min-h-screen place-items-center bg-gray-50 px-4">
          <section className="w-full max-w-md space-y-4 border border-gray-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-bold text-gray-950">Verificação em duas etapas</h1>
            <MfaPanel challengeOnly />
            <SignOutButton />
          </section>
        </main>
      );
    }

    userEmail = user.email ?? "";

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, fone, status, is_admin, created_at, email_reminders_enabled")
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

    isAdmin = Boolean(profile.is_admin);
    userFone = profile.fone ?? "";
    emailRemindersEnabled = Boolean(profile.email_reminders_enabled);

    if (isAdmin && activeView === "configuracoes") {
      const { data: profiles, error: pendingError } = await supabase
        .from("profiles")
        .select("id, email, fone, status, is_admin, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true });

      if (pendingError) {
        throw new Error(pendingError.message);
      }

      pendingUsers = (profiles as UserProfile[] | null) ?? [];
    }

    if (activeView !== "configuracoes" && activeView !== "integracoes") {
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
        .order("data_vencimento", { ascending: true });
      const pagamentosQuery = needsPayments
        ? supabase.from("pagamentos").select("id, cliente_id, valor_total, recebido_em, tipo, referencia_pagamento_id, clientes(id, nome, telefone, cpf), pagamento_itens(valor_principal, valor_juros, parcelas(numero))").order("recebido_em", { ascending: false })
        : Promise.resolve({ data: [], error: null });
      const contatosQuery = needsContacts
        ? supabase.from("cobranca_contatos").select("id, parcela_id, canal, observacao, realizado_em").order("realizado_em", { ascending: false })
        : Promise.resolve({ data: [], error: null });
      const arquivadasQuery = needsArchivedRows
        ? supabase.from("emprestimos").select("id, descricao, deleted_at, clientes!inner(id, nome, telefone, cpf, endereco), parcelas(numero, valor, status, data_vencimento)", { count: "exact" }).not("deleted_at", "is", null).order("deleted_at", { ascending: false })
        : supabase.from("emprestimos").select("id", { count: "exact", head: true }).not("deleted_at", "is", null);

      const [parcelasResult, pagamentosResult, contatosResult, arquivadasResult] = await Promise.all([
        parcelasQuery,
        pagamentosQuery,
        contatosQuery,
        arquivadasQuery,
      ]);

      if (parcelasResult.error) throw new Error(parcelasResult.error.message);
      if (pagamentosResult.error) throw new Error(pagamentosResult.error.message);
      if (contatosResult.error) throw new Error(contatosResult.error.message);
      if (arquivadasResult.error) throw new Error(arquivadasResult.error.message);

      parcelas = (parcelasResult.data as unknown as ParcelaComCliente[]) ?? [];
      pagamentos = (pagamentosResult.data ?? []) as unknown as PagamentoResumo[];
      contatos = (contatosResult.data ?? []) as unknown as ContatoResumo[];
      arquivadas = (arquivadasResult.data ?? []) as unknown as CobrancaArquivada[];
      arquivadasCount = arquivadasResult.count ?? arquivadas.length;
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
  const limiteLembretes = new Date(hoje);
  limiteLembretes.setDate(limiteLembretes.getDate() + 7);
  const limiteLembretesStr = formatDateOnly(limiteLembretes);
  const lembretes = abertas.filter((parcela) => parcela.data_vencimento <= limiteLembretesStr);
  const mesInicio = `${mesSelecionado}-01`;
  const [anoMesAno, anoMesMes] = mesSelecionado.split("-").map(Number);
  const proximoMes = new Date(anoMesAno, anoMesMes, 1);
  const mesFim = formatDateOnly(new Date(proximoMes.getFullYear(), proximoMes.getMonth(), 0));
  const mesAnterior = new Date(anoMesAno, anoMesMes - 2, 1).toISOString().slice(0, 7);
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

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-950 sm:text-2xl">
              Recebify • Gestão de cobranças
            </h1>
            <p className="text-sm font-medium text-gray-500">
              {activeView === "configuracoes" || activeView === "integracoes" ? userEmail : `${userEmail} • ${abertas.length} em aberto • ${atrasadas.length} atrasada(s)`}
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

        {activeView !== "configuracoes" && activeView !== "integracoes" ? <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

        <nav aria-label="Áreas do sistema" className="flex flex-wrap gap-2 border border-gray-200 bg-white p-3">
          {(["abertas", "lembretes", "financeiro", "historico", "lixeira", "integracoes", "configuracoes"] as ViewFilter[]).map((view) => (
            <a key={view} href={buildHref({ view, q, mes: view === "financeiro" ? mesSelecionado : undefined })}
              aria-current={activeView === view ? "page" : undefined}
              className={`min-h-10 px-4 py-2 text-sm font-bold ${activeView === view ? "bg-blue-700 text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
              {viewLabels[view]}
              {view === "lembretes" && activeView !== "configuracoes" ? ` (${lembretes.length})` : view === "lixeira" && activeView !== "configuracoes" ? ` (${arquivadasCount})` : ""}
            </a>
          ))}
          {activeView !== "configuracoes" && activeView !== "integracoes" ? <>
            <a href="/api/export" className="min-h-10 border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">Exportar cobranças CSV</a>
            <a href="/api/export?tipo=pagamentos" className="min-h-10 border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">Exportar pagamentos CSV</a>
            <a href="/api/export?formato=json" className="min-h-10 border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">Baixar backup JSON</a>
          </> : null}
        </nav>

        {activeView === "integracoes" ? (
          <section className="mx-auto w-full max-w-5xl space-y-6" aria-labelledby="integrations-title">
            <header className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-blue-50 p-6 shadow-sm sm:p-8">
              <div className="flex items-start gap-4">
                <div aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-6"><path strokeLinecap="round" strokeLinejoin="round" d="M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 2.93l-1.72 1.72M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21.07l1.72-1.72" /></svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-blue-700">Conecte suas ferramentas</p>
                  <h2 id="integrations-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Integrações</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Ligue o Recebify ao Asaas para emitir cobranças e acompanhar pagamentos sem sair da sua rotina.</p>
                </div>
              </div>
            </header>
            <AsaasSettingsPanel />
          </section>
        ) : null}

        {activeView === "configuracoes" ? (
          <section className="space-y-5" aria-labelledby="settings-title">
            <header className="border border-gray-200 bg-white p-5 shadow-sm">
              <h2 id="settings-title" className="text-xl font-bold text-gray-950">Configurações</h2>
              <p className="mt-1 text-sm text-gray-600">Gerencie seus dados, recebimentos, plano, segurança e backups em um só lugar.</p>
              <nav aria-label="Seções de configurações" className="mt-4 flex flex-wrap gap-2">
                {[
                  ["#dados-da-conta", "Conta"],
                  ["#assinatura", "Plano"],
                  ["#seguranca", "Segurança"],
                  ["#backup", "Backup"],
                  ...(isAdmin ? [["#acessos", "Acessos"]] : []),
                ].map(([href, label]) => (
                  <a key={href} href={href} className="min-h-9 border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:border-blue-700 hover:text-blue-700">{label}</a>
                ))}
              </nav>
            </header>
            <AccountSettingsPanel email={userEmail} fone={userFone} emailRemindersEnabled={emailRemindersEnabled} />
            {isAdmin ? <div id="acessos" className="scroll-mt-24"><AdminApprovalPanel pendingUsers={pendingUsers} /></div> : null}
          </section>
        ) : null}

        {activeView === "financeiro" ? (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 border border-gray-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
              <div><h2 className="text-lg font-bold text-gray-950">Resumo financeiro</h2><p className="text-sm text-gray-600">Entradas usam a data real do pagamento. O histórico mensal detalhado começa após a migração.</p></div>
              <form action="/" className="flex items-end gap-2"><input type="hidden" name="view" value="financeiro" /><label className="text-xs font-bold text-gray-600">Período<input name="mes" type="month" defaultValue={mesSelecionado} className="mt-1 block min-h-10 border border-gray-300 px-3 text-sm" /></label><button className="min-h-10 bg-blue-700 px-4 text-sm font-bold text-white">Aplicar</button></form>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                <ContatoCobrancaForm parcelaId={parcela.id} />
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
            {arquivadas.length === 0 ? <div className="border border-gray-200 bg-white p-6 text-sm text-gray-600">A lixeira está vazia.</div> : arquivadas.map((item) => { const cliente = Array.isArray(item.clientes) ? item.clientes[0] : item.clientes; return <article key={item.id} className="flex flex-col justify-between gap-4 border border-gray-200 bg-white p-4 sm:flex-row sm:items-center"><div><h3 className="font-bold text-gray-950">{cliente?.nome ?? "Cliente"} · {item.descricao || "Cobrança"}</h3><p className="text-sm text-gray-500">Arquivada em {new Date(item.deleted_at).toLocaleDateString("pt-BR")} · {item.parcelas?.length ?? 0} parcelas</p></div><RestaurarCobrancaButton emprestimoId={item.id} /></article>; })}
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
        /> : null}
      </div>
    </main>
  );
}
