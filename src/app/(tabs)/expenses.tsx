import ExpensesScreen from "@/features/expenses/screens/ExpensesScreen";
import { freezeWhenBlurred } from "@/providers/FreezeWhenBlurred";

export default freezeWhenBlurred(ExpensesScreen);
