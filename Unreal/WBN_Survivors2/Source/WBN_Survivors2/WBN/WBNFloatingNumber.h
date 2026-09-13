// WBN Survivors 2 — Fliegende Schadenszahl (TextRender, ohne UMG-Assets).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WBNFloatingNumber.generated.h"

class UTextRenderComponent;

UCLASS()
class WBN_SURVIVORS2_API AWBNFloatingNumber : public AActor
{
	GENERATED_BODY()

public:
	AWBNFloatingNumber();

	/** Zahl am Ort erzeugen (steigt + blendet aus). */
	static AWBNFloatingNumber* Spawn(UWorld* World, const FVector& At, const FString& Text, const FLinearColor& Color);

	virtual void Tick(float DeltaTime) override;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Feel")
	TObjectPtr<UTextRenderComponent> Text;

	float Age = 0.f;
	float Life = 0.8f;
	FVector RiseDir = FVector(0.f, 0.f, 1.f);
};