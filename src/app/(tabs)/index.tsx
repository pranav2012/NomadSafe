import HomeScreen from "@/features/home/screens/HomeScreen";
import { freezeWhenBlurred } from "@/providers/FreezeWhenBlurred";

export default freezeWhenBlurred(HomeScreen);
