// WBN Survivors 2 — Arena-Daten, Felder aus ARENAS (src/data.js).
// w/h in px (Web-Einheiten, Umrechnung beim Blockout).
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "WBNArenaData.generated.h"

/** Eine Arena (ARENAS-Eintrag). */
UCLASS(BlueprintType)
class UWBNArenaData : public UDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") FString ArenaId;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") FText Name;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") float Width = 1000.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") float Height = 850.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") FLinearColor Ground = FLinearColor::Green;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") FLinearColor Grid = FLinearColor::Green;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") FLinearColor Accent = FLinearColor::White;
	/** Layout-Thema (offen/eng/weit/räume/boss). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") FString Theme = TEXT("offen");
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") int32 Buildings = 3;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") int32 Cover = 5;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") int32 Poison = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") int32 SpeedField = 2;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena") int32 MovingWalls = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Arena", meta = (MultiLine = true)) FText Desc;
};
