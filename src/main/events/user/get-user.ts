import { registerEvent } from "../register-event";
import { HydraApi, logger } from "@main/services";
import { steamGamesWorker } from "@main/workers";
import type { UserProfile } from "@types";
import { getUserFriends } from "./get-user-friends";
import { steamUrlBuilder } from "@shared";

const getSteamGame = async (objectId: string) => {
  try {
    const steamGame = await steamGamesWorker.run(Number(objectId), {
      name: "getById",
    });

    return {
      title: steamGame.name,
      iconUrl: steamUrlBuilder.icon(objectId, steamGame.clientIcon),
    };
  } catch (err) {
    logger.error("Failed to get Steam game", err);

    return null;
  }
};

const getUser = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
): Promise<UserProfile | null> => {
  try {
    const [profile, friends] = await Promise.all([
      HydraApi.get<UserProfile | null>(`/users/${userId}`),
      getUserFriends(userId, 12, 0).catch(() => {
        return { totalFriends: 0, friends: [] };
      }),
    ]);

    if (!profile) return null;

    const recentGames = await Promise.all(
      profile.recentGames
        .map(async (game) => {
          const steamGame = await getSteamGame(game.objectId);

          return {
            ...game,
            ...steamGame,
          };
        })
        .filter((game) => game)
    );

    const libraryGames = await Promise.all(
      profile.libraryGames
        .map(async (game) => {
          const steamGame = await getSteamGame(game.objectId);

          return {
            ...game,
            ...steamGame,
          };
        })
        .filter((game) => game)
    );

    if (profile.currentGame) {
      const steamGame = await getSteamGame(profile.currentGame.objectId);

      if (steamGame) {
        profile.currentGame = {
          ...profile.currentGame,
          ...steamGame,
        };
      }
    }

    return {
      ...profile,
      libraryGames,
      recentGames,
      friends: friends.friends,
      totalFriends: friends.totalFriends,
    };
  } catch (err) {
    console.log("err", err);
    return null;
  }
};

registerEvent("getUser", getUser);
