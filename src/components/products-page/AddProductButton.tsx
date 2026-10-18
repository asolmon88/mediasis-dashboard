'use client'

import { Plus } from "lucide-react";
import { Button } from "../ui/button";
import { useRouter } from "next/navigation";

export default function AddProductButton() {
  const router = useRouter();

  return (
    <Button onClick={() => {
      router.push('/admin/products/new')
    }}>
      <Plus/> Agregar productos
    </Button>
  );
}