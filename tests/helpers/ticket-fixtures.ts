import type { TicketCore } from "../../lib/tickets";

export function ticketFixture(date: string, overrides: Partial<TicketCore> = {}): TicketCore {
  return {
    eventId: "departure", direction: "departure", mode: "train", serviceNumber: "G123",
    date, departureTime: "06:30", arrivalDate: date, arrivalTime: "07:30",
    fromName: "测试出发站", fromDetail: "东进站口", toName: "长沙南站", toDetail: "西出站口",
    chainOriginName: "家门口公共地标", chainDestinationName: "目的地酒店",
    accessMode: "driving", accessDurationMinutes: 10, accessFareCents: 2000, accessNote: "全段含停车",
    egressMode: "walking", egressDurationMinutes: 10, egressFareCents: 0, egressNote: "含出站步行",
    baggageNote: "轻便背包，无需托运", passengerCount: 1, fareCents: 10000,
    checkInCutoffMinutes: null, bagDropCutoffMinutes: null, boardingCutoffMinutes: 5,
    bufferMinutes: 5, note: null, ...overrides,
  };
}
