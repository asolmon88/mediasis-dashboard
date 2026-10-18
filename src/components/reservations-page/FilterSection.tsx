import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { Dispatch, SetStateAction } from "react";
import { statusOptions } from "@/lib/dashboardData";

export function FilterSection({
  showByType,
  setShowByType,
}:{
  showByType: string,
  setShowByType: Dispatch<SetStateAction<string>>
}) {
  return (
    <div className="flex flex-row items-center text-sm space-x-4">
      <p> Mostrar por: </p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {showByType}
            <ChevronDown/>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Seleccione uno:</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={()=>{
            setShowByType('Fecha');
          }}>Fecha</DropdownMenuItem>
          <DropdownMenuItem onClick={()=> {
            setShowByType('Calendario');
          }}>Calendario</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}