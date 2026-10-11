import { CustomerForm } from "@/components/customer-form";

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">تسجيل عميل / مورد</h1>
      <CustomerForm />
    </div>
  );
}
