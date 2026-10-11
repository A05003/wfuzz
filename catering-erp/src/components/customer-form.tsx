"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { customerSchema, type CustomerInput } from "@/lib/schemas";
import { createCustomer } from "@/actions/customers";

export function CustomerForm() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: { kind: "CUSTOMER", nameAr: "", nameEn: "", vatNumber: "", accountSubGroup: "", costCenter: "", phone: "", address: "" },
  });
  const field = (name: keyof CustomerInput, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-sm">
      {label}
      <input className="input mt-1" {...props} {...register(name)} />
      {errors[name] && <p className="err">{errors[name]?.message}</p>}
    </label>
  );

  return (
    <form
      className="card grid max-w-3xl gap-4 sm:grid-cols-2"
      onSubmit={handleSubmit((v) =>
        start(async () => {
          const r = await createCustomer(v);
          setMsg(r.ok ? { ok: true, text: "تم الحفظ" } : { ok: false, text: r.error });
          if (r.ok) reset();
        }),
      )}
    >
      <label className="block text-sm">
        النوع
        <select className="input mt-1" {...register("kind")}>
          <option value="CUSTOMER">عميل</option>
          <option value="VENDOR">مورد</option>
        </select>
      </label>
      {field("nameAr", "الاسم (عربي)")}
      {field("nameEn", "الاسم (إنجليزي)", { dir: "ltr" })}
      {field("vatNumber", "الرقم الضريبي (15 رقم)", { dir: "ltr", maxLength: 15, inputMode: "numeric" })}
      {field("accountSubGroup", "المجموعة الفرعية للحساب")}
      {field("costCenter", "مركز التكلفة")}
      {field("phone", "الجوال", { dir: "ltr" })}
      {field("address", "العنوان")}
      <div className="sm:col-span-2">
        <button className="btn" disabled={pending}>حفظ</button>
        {msg && <span className={msg.ok ? "ms-3 text-sm text-green-600" : "err ms-3"}>{msg.text}</span>}
      </div>
    </form>
  );
}
