interface Props {
  ok?: string | null;
  err?: string | null;
}

export default function Feedback({ ok, err }: Props) {
  if (!ok && !err) return null;
  return (
    <div
      className={`mt-4 rounded-lg px-4 py-3 text-sm break-all ${
        err
          ? "border border-red-200 bg-red-50 text-red-700"
          : "border border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
    >
      {err ?? ok}
    </div>
  );
}

export function TxLink({ sig }: { sig: string }) {
  return (
    <a
      href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-emerald-400 underline-offset-2 hover:text-emerald-800"
    >
      {sig.slice(0, 16)}...
    </a>
  );
}
