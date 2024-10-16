import {
  gameAchievementRepository,
  gameRepository,
  userPreferencesRepository,
} from "@main/repository";
import type { AchievementData, GameShop, UnlockedAchievement } from "@types";
import { WindowManager } from "../window-manager";
import { HydraApi } from "../hydra-api";
import { getGameAchievements } from "@main/events/catalogue/get-game-achievements";

const saveAchievementsOnLocal = async (
  objectId: string,
  shop: string,
  achievements: any[]
) => {
  return gameAchievementRepository
    .upsert(
      {
        objectId,
        shop,
        unlockedAchievements: JSON.stringify(achievements),
      },
      ["objectId", "shop"]
    )
    .then(() => {
      return getGameAchievements(objectId, shop as GameShop)
        .then((achievements) => {
          WindowManager.mainWindow?.webContents.send(
            `on-update-achievements-${objectId}-${shop}`,
            achievements
          );
        })
        .catch(() => {});
    });
};

export const mergeAchievements = async (
  objectId: string,
  shop: string,
  achievements: UnlockedAchievement[],
  publishNotification: boolean
) => {
  const game = await gameRepository.findOne({
    where: { objectID: objectId, shop: shop as GameShop },
  });

  if (!game) return;

  const [localGameAchievement, userPreferences] = await Promise.all([
    gameAchievementRepository.findOne({
      where: {
        objectId,
        shop,
      },
    }),
    userPreferencesRepository.findOne({ where: { id: 1 } }),
  ]);

  const achievementsData = JSON.parse(
    localGameAchievement?.achievements || "[]"
  ) as AchievementData[];

  const unlockedAchievements = JSON.parse(
    localGameAchievement?.unlockedAchievements || "[]"
  ).filter((achievement) => achievement.name) as UnlockedAchievement[];

  const newAchievements = achievements
    .filter((achievement) => {
      return !unlockedAchievements.some((localAchievement) => {
        return (
          localAchievement.name.toUpperCase() === achievement.name.toUpperCase()
        );
      });
    })
    .map((achievement) => {
      return {
        name: achievement.name.toUpperCase(),
        unlockTime: achievement.unlockTime,
      };
    });

  if (
    newAchievements.length &&
    publishNotification &&
    userPreferences?.achievementNotificationsEnabled
  ) {
    const achievementsInfo = newAchievements
      .sort((a, b) => {
        return a.unlockTime - b.unlockTime;
      })
      .map((achievement) => {
        return achievementsData.find((steamAchievement) => {
          return (
            achievement.name.toUpperCase() ===
            steamAchievement.name.toUpperCase()
          );
        });
      })
      .filter((achievement) => achievement)
      .map((achievement) => {
        return {
          displayName: achievement!.displayName,
          iconUrl: achievement!.icon,
        };
      });

    WindowManager.notificationWindow?.webContents.send(
      "on-achievement-unlocked",
      objectId,
      shop,
      achievementsInfo
    );
  }

  const mergedLocalAchievements = unlockedAchievements.concat(newAchievements);

  if (game?.remoteId) {
    return HydraApi.put(
      "/profile/games/achievements",
      {
        id: game.remoteId,
        achievements: mergedLocalAchievements,
      },
      { needsCloud: true }
    )
      .then((response) => {
        return saveAchievementsOnLocal(
          response.objectId,
          response.shop,
          response.achievements
        );
      })
      .catch(() => {
        return saveAchievementsOnLocal(objectId, shop, mergedLocalAchievements);
      });
  }

  return saveAchievementsOnLocal(objectId, shop, mergedLocalAchievements);
};