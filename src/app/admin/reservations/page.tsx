"use client"

import { CalendarView } from "@/components/reservations-page/CalendarView";
import DateSection from "@/components/reservations-page/DateSection";
import { FilterSection } from "@/components/reservations-page/FilterSection";
import MonthSection from "@/components/reservations-page/MonthSection";
import ReservationsTable from "@/components/reservations-page/ReservationsTable";
import { Button } from "@/components/ui/button";
import { Reservation } from "@/lib/types/dashboardTypes";
import {  Loader2Icon, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Item,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";
import { getReservation, getReservations, getReservationStorefrontDomain } from "./actions";
import { useDashboardAccessToken, useDashboardSupabase } from "@/hooks/use-dashboard-supabase";
import { useReservationLocation } from "@/hooks/use-reservation-location";

export default function ReservationsPage() {
  const { activeLocationId } = useReservationLocation();
  const supabase = useDashboardSupabase();
  const getAccessToken = useDashboardAccessToken();
  const [isMounted, setIsMounted] = useState(false);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [showByType, setShowByType] = useState<string>('Calendario');
  const [reservations, setReservations] = useState<Reservation[] | null>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [audio] = useState(
    typeof Audio !== "undefined" ? new Audio("/sounds/reservation_notif.mp3") : null
  );
  const activeLocationIdRef = useRef<string | null>(activeLocationId);
  activeLocationIdRef.current = activeLocationId;

  useEffect(() => {
    setIsMounted(true);
  }, [])

  const fetchReservations = async () => {
    setLoading(true);
    setReservations([]);
    if (!activeLocationId) {
      setLoading(false);
      return;
    }
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const monthStartLocal = new Date(year, month, 1, 0, 0, 0, 0);      // local 00:00 on 1st
    const monthEndLocal   = new Date(year, month + 1, 1, 0, 0, 0, 0);  // local 00:00 on 1st next month

    // Convert those local instants to UTC ISO strings (exact instants)
    const monthStartUTCISO = monthStartLocal.toISOString();
    const monthEndUTCISO   = monthEndLocal.toISOString();

    const result = await getReservations(activeLocationId, monthStartUTCISO, monthEndUTCISO);
    if (!result.success) {
      toast.error(result.message);
    } else if (activeLocationIdRef.current === activeLocationId) {
      setReservations(result.reservations);
    }
    setLoading(false);
  }

  async function fetchOneReservation(id: string, locationId: string) {
    const result = await getReservation(locationId, id);
    if (!result.success) throw new Error(result.message);
    if (!result.reservation) throw new Error("No se pudo cargar la reservación.");
    return result.reservation;
  }

  useEffect(() => {
    if (!isMounted) return;
    fetchReservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate.getFullYear(), currentDate.getMonth(), isMounted, activeLocationId]);
  

  useEffect(() => {
    if (!activeLocationId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      supabase.realtime.setAuth(token);

      // 3) Subscribe
      channel = supabase
        .channel(`reservation-changes-${activeLocationId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "mediasis", table: "reservations", filter: `business_location_id=eq.${activeLocationId}` },
          async (payload: { new: Reservation }) => {
            if (activeLocationIdRef.current !== activeLocationId) return;
            const newReservation = payload.new as Reservation;

            setReservations((reservations)=> {
              const updated = reservations === null ? [] :
              reservations.map((reservation)=>
                reservation.id === newReservation.id ?
                { ...reservation, updated_at: newReservation.updated_at, date:newReservation.date, size: newReservation.size, status: newReservation.status, price: newReservation.price, payment_proof_url: newReservation.payment_proof_url, extra_details: newReservation.extra_details } : reservation
              )
              return updated.sort(
                (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
              );
            })
          }
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "mediasis", table: "reservations", filter: `business_location_id=eq.${activeLocationId}` },
          async (payload: { new: Reservation }) => {
            if (activeLocationIdRef.current !== activeLocationId) return;
            playSound();
            const newReservation = payload.new as Reservation;
            newReservation.client = (await fetchOneReservation(newReservation.id, activeLocationId)).client
            if (activeLocationIdRef.current !== activeLocationId) return;
            setReservations((reservations) => {
              const updated = reservations === null ? [newReservation] :
              [...reservations, newReservation]
              return updated.sort(
                (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
              );
            })
          }
        )
        .subscribe((status: string) => console.log("subscription:", status));
    })();
      
    return () => {
      if (channel) supabase.removeChannel(channel);
    };

  }, [activeLocationId, getAccessToken, supabase]);

  useEffect(() => {
    const rebind = async () => {
      const token = await getAccessToken();
      if (token) supabase.realtime.setAuth(token);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void rebind();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [getAccessToken, supabase]);

  const playSound = () => {
    if (audio) {
      audio.currentTime = 0; // restart from beginning
      audio.play();
    }
  };

  const goToPreviousDay = () => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setDate(prev.getDate() - 1);
      return newDate;
    });
  };

  const goToNextDay = () => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setDate(prev.getDate() + 1);
      return newDate;
    });
  };

  const goToCreateReservation = async () => {
    setLoading(true);
    const result = await getReservationStorefrontDomain();
    if (result.success && result.domain) {
      window.open(`https://reservaciones.${result.domain}`, '_blank', 'noopener,noreferrer');
      setLoading(false);
    } else {
      toast.error('Error al obtener dominio de reservas.')
      setLoading(false);
    }

  }

  return (
    <div className="px-4 py-2 flex flex-col space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={goToCreateReservation}>
          <Plus/>
          Crear Reserva
        </Button>
      </div>
      <FilterSection
        showByType={showByType}
        setShowByType={setShowByType}
      />
      {showByType === 'Fecha' ?
        <>
          <DateSection
            currentDate={currentDate}
            setCurrentDate={setCurrentDate}
            goToNextDay={goToNextDay}
            goToPreviousDay={goToPreviousDay}
          />
          {loading && (
            <Item className="self-center">
              <ItemContent>
                <ItemTitle><Loader2Icon className="animate-spin" /> Cargando reservas</ItemTitle>
              </ItemContent>
            </Item>
          )}
          <ReservationsTable date={currentDate} reservations={reservations} loading={loading}/>
        </> :
        <>
          <MonthSection
            currentDate={currentDate}
            setCurrentDate={setCurrentDate}
          />
          {loading && (
            <Item>
              <ItemContent>
                <ItemTitle><Loader2Icon className="animate-spin" /> Cargando reservas</ItemTitle>
              </ItemContent>
            </Item>
          )}
          <CalendarView date={currentDate} reservations={reservations?.filter((res)=>res.status === 'confirmed' || res.status === 'pending')} setCurrentDate={setCurrentDate} setShowByType={setShowByType}/>
        </>
      }
    </div>
  );
}
