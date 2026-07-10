import { getBookingSlots } from "./actions";
import { BookingWidget } from "@/components/BookingWidget";

export const dynamic = "force-dynamic";

export default async function AgendarPage({ params }: { params: { token: string } }) {
  const res = (await getBookingSlots(params.token)) as any;

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 text-center">
          <p className="font-display text-xl font-bold text-brand-dark">Contatia</p>
        </div>
        {res?.error ? (
          <div className="card p-8 text-center">
            <p className="font-display text-lg font-bold">Agenda indisponível</p>
            <p className="mt-1 text-sm text-subtle">{res.error}</p>
          </div>
        ) : (
          <div className="card p-6">
            <h1 className="font-display text-2xl font-bold">Agende com {res.tenantName}</h1>
            <p className="mt-1 text-sm text-subtle">Escolha um horário de {res.duration} minutos. Você recebe a confirmação por e-mail.</p>
            <div className="mt-5">
              <BookingWidget token={params.token} slots={res.slots} />
            </div>
          </div>
        )}
        <p className="mt-6 text-center text-xs text-subtle">Agendamento por Contatia</p>
      </div>
    </div>
  );
}
