import { calcularJurosAtraso, diasAtraso, formatDateOnly } from "@/lib/loan-utils";
import type { PeriodicidadeVencimento, TipoJurosAtraso } from "@/lib/loan-utils";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AuthPanel, SignOutButton } from "./components/AuthPanel";
import { NovoEmprestimoModal } from "./components/NovoEmprestimoModal";
import { MarcarPagoButton } from "./components/MarcarPagoButton";
import { RegistrarPagamentoForm } from "./components/RegistrarPagamentoForm";
import { aprovarUsuario } from "./actions";

export const dynamic = "force-dynamic";

type ParcelaStatus = "Pendente" | "Pago" | string;
type ViewFilter = "abertas" | "atrasadas" | "pagas" | "todas";

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
    periodicidade_vencimento: PeriodicidadeVencimento | null;
    intervalo_personalizado_dias: number | null;
    juros_atraso_tipo: TipoJurosAtraso | null;
    juros_atraso_valor: number | null;
    clientes: { id: string; nome: string } | null;
  } | null;
};

type ClienteResumo = {
  clienteId: string;
  nome: string;
  parcelas: ParcelaComCliente[];
  parcelasVisiveis: ParcelaComCliente[];
  proximaParcela: ParcelaComCliente | null;
  totalRestante: number;
  totalAtrasado: number;
  atrasadas: number;
  proximoVencimento: string | null;
};

type PageProps = {
  searchParams?: Promise<{
    convite?: string;
    q?: string;
    view?: string;
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
  return parcelas.reduce((total, parcela) => total + getValorPago(parcela), 0);
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
  if (value === "atrasadas" || value === "pagas" || value === "todas") {
    return value;
  }

  return "abertas";
}

function buildHref({
  view,
  q,
}: {
  view: ViewFilter;
  q: string;
}) {
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
              Parcela {parcela.numero} de {parcela.emprestimo_id.slice(0, 8)}
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

  return (
    <details className="group border border-gray-200 bg-white shadow-sm">
      <summary className="grid cursor-pointer list-none gap-4 p-5 marker:hidden lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="truncate text-xl font-bold text-gray-950">{cliente.nome}</h3>
              <p className="mt-1 text-sm font-medium text-gray-600">
                {cliente.parcelas.length} parcela(s) em aberto •{" "}
                {cliente.parcelasVisiveis.length} nesta visão
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
        </div>

        <span className="border border-gray-300 px-4 py-2 text-center text-sm font-bold text-gray-700 group-open:bg-gray-950 group-open:text-white">
          Ver parcelas
        </span>
      </summary>

      <div className="border-t border-gray-200 p-5 pt-4">
        {proximaParcela ? (
          <div className="mb-5 flex flex-col gap-3 border border-blue-100 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                Próxima parcela
              </p>
              <p className="mt-1 text-sm font-bold text-blue-950">
                Parcela {proximaParcela.numero} • falta{" "}
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
  const normalizedQuery = q.toLocaleLowerCase("pt-BR");
  const activeView = normalizeView(params.view);
  const inviteCode = process.env.ACCESS_INVITE_CODE ?? "";
  const hasValidInvite =
    inviteCode.length > 0 && params.convite === inviteCode;
  const hoje = new Date();
  const hojeStr = formatDateOnly(hoje);
  let parcelas: ParcelaComCliente[] = [];
  let pendingUsers: UserProfile[] = [];
  let fetchError: string | null = null;
  let userEmail = "";
  let isAdmin = false;

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return <AuthPanel allowSignup={hasValidInvite} />;
    }

    userEmail = user.email ?? "";

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, fone, status, is_admin, created_at")
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

    if (isAdmin) {
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

    const { data, error } = await supabase
      .from("parcelas")
      .select(
        `
        id,
        numero,
        valor,
        valor_pago,
        valor_juros_atraso_pago,
        data_vencimento,
        data_pagamento,
        status,
        emprestimo_id,
        emprestimos (
          id,
          periodicidade_vencimento,
          intervalo_personalizado_dias,
          juros_atraso_tipo,
          juros_atraso_valor,
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

  const visibleParcelas = {
    abertas,
    atrasadas,
    pagas,
    todas: filtradasPorBusca,
  }[activeView];
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
              Gestão de Empréstimo
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

        {isAdmin ? <AdminApprovalPanel pendingUsers={pendingUsers} /> : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
        </section>

        <ClientesSection
          title={viewLabels[activeView]}
          clientes={visibleClientes}
          hoje={hoje}
          hojeStr={hojeStr}
        />
      </div>
    </main>
  );
}
