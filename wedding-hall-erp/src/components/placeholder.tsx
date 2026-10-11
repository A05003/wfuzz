export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="card">
      <h1 className="mb-2 text-xl font-bold">{title}</h1>
      <p className="text-sm text-brand-700">سيتم بناء هذه الصفحة في {phase}.</p>
    </div>
  );
}
