export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">
        هذا القسم قيد التجهيز وسيُبنى في مرحلة لاحقة.
      </p>
    </div>
  );
}
