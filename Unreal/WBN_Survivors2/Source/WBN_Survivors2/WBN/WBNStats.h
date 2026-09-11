// WBN Survivors 2 — Stat-Block, 1:1 aus STAT_DEF (src/data.js) portiert.
#pragma once

#include "CoreMinimal.h"
#include "WBNStats.generated.h"

/** 24 Spielwerte. Unbenutzte bleiben 0 (entspricht zeroStats() im Web-Spiel). */
USTRUCT(BlueprintType)
struct FWBNStats
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats") float MaxHp = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats") float HpRegen = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats", meta = (Units = "%")) float Lifesteal = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats", meta = (Units = "%")) float DmgP = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats") float Melee = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats") float Ranged = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats") float Elem = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats", meta = (Units = "%")) float AtkSpd = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats", meta = (Units = "%")) float Crit = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats", meta = (Units = "%")) float CritDmg = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats") float Eng = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats", meta = (Units = "%")) float Range = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats") float Armor = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats", meta = (Units = "%")) float Dodge = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats", meta = (Units = "%")) float Speed = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats") float Luck = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats") float Harvest = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats", meta = (Units = "%")) float XpGain = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats", meta = (Units = "%")) float ExpSize = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats") float Pierce = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats") float Bounce = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats", meta = (Units = "%")) float Knock = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats") float AbilityRank = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "WBN|Stats", meta = (Units = "%")) float AbilityCdMod = 0.f;

	FWBNStats operator+(const FWBNStats& O) const
	{
		FWBNStats R;
		R.MaxHp = MaxHp + O.MaxHp; R.HpRegen = HpRegen + O.HpRegen; R.Lifesteal = Lifesteal + O.Lifesteal;
		R.DmgP = DmgP + O.DmgP; R.Melee = Melee + O.Melee; R.Ranged = Ranged + O.Ranged;
		R.Elem = Elem + O.Elem; R.AtkSpd = AtkSpd + O.AtkSpd; R.Crit = Crit + O.Crit;
		R.CritDmg = CritDmg + O.CritDmg; R.Eng = Eng + O.Eng; R.Range = Range + O.Range;
		R.Armor = Armor + O.Armor; R.Dodge = Dodge + O.Dodge; R.Speed = Speed + O.Speed;
		R.Luck = Luck + O.Luck; R.Harvest = Harvest + O.Harvest; R.XpGain = XpGain + O.XpGain;
		R.ExpSize = ExpSize + O.ExpSize; R.Pierce = Pierce + O.Pierce; R.Bounce = Bounce + O.Bounce;
		R.Knock = Knock + O.Knock; R.AbilityRank = AbilityRank + O.AbilityRank; R.AbilityCdMod = AbilityCdMod + O.AbilityCdMod;
		return R;
	}
};
