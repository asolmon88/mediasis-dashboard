'use client'

import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation'

export function BackButton({label}:{label: string}) {
  const router = useRouter();

  function handleReturn() {
    router.back();
  }

  return (
    <Button
      variant="ghost"
      onClick={handleReturn}
      className="justify-start mb-4"
    >
      <ArrowLeft /> {label}
    </Button>
  )
}
