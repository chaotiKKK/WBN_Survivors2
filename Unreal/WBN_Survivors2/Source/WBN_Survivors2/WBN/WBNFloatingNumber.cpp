// WBN Survivors 2 — Schadenszahlen.
#include "WBNFloatingNumber.h"
#include "Components/TextRenderComponent.h"
#include "Engine/World.h"

AWBNFloatingNumber::AWBNFloatingNumber()
{
	PrimaryActorTick.bCanEverTick = true;
	SetLifeSpan(Life + 0.2f);

	RootComponent = Text = CreateDefaultSubobject<UTextRenderComponent>(TEXT("Text"));
	Text->SetHorizontalAlignment(EHorizTextAligment::EHTA_Center);
	Text->SetWorldSize(90.f);
	Text->SetTextRenderColor(FColor::White);
	Text->SetRelativeScale3D(FVector(1.f, 1.f, 0.25f));
	Text->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

AWBNFloatingNumber* AWBNFloatingNumber::Spawn(UWorld* World, const FVector& At, const FString& TextValue, const FLinearColor& Color)
{
	if (!World)
	{
		return nullptr;
	}
	AWBNFloatingNumber* N = World->SpawnActor<AWBNFloatingNumber>(AWBNFloatingNumber::StaticClass(), At + FVector(0.f, 0.f, 60.f), FRotator::ZeroRotator);
	if (N)
	{
		N->Text->SetText(FText::FromString(TextValue));
		N->Text->SetTextRenderColor(Color.ToFColor(true));
	}
	return N;
}

void AWBNFloatingNumber::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	Age += DeltaTime;
	const float Frac = Age / Life;
	SetActorLocation(GetActorLocation() + RiseDir * (120.f * DeltaTime));
	if (Text)
	{
		const float Alpha = 1.f - Frac;
		Text->SetTextRenderColor(Text->TextRenderColor.WithAlpha((uint8)(Alpha * 255.f)));
	}
	if (Age >= Life)
	{
		Destroy();
	}
}