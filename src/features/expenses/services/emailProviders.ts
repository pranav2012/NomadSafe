import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import {
  hotelNameFromEmail,
  isConfirmedBooking,
  isFlightEmail,
  isStayEmail,
  merchantFromSender,
} from "@/features/expenses/services/transactionParser";

export interface EmailProviderMatch {
  provider: "booking-com" | "smartbuy" | "flight" | "stay" | "generic";
  category?: ExpenseCategory;
  merchant?: string;
  committedBooking: boolean;
}

export function matchEmailProvider(body: string, sender?: string): EmailProviderMatch {
  const context = `${sender ?? ""} ${body}`;
  const committedBooking = isConfirmedBooking(context);

  if (/\bbooking\.com\b/i.test(context)) {
    return {
      provider: "booking-com",
      category: "stays",
      merchant: hotelNameFromEmail(body) || merchantFromSender(sender),
      committedBooking,
    };
  }

  if (/\bsmartbuy\b|\bgoibibo\b/i.test(context)) {
    return {
      provider: "smartbuy",
      category: "travel",
      merchant: "SmartBuy",
      committedBooking,
    };
  }

  if (isFlightEmail(context)) {
    return { provider: "flight", category: "travel", committedBooking };
  }

  if (isStayEmail(context)) {
    return {
      provider: "stay",
      category: "stays",
      merchant: hotelNameFromEmail(body) || merchantFromSender(sender),
      committedBooking,
    };
  }

  return { provider: "generic", committedBooking };
}
