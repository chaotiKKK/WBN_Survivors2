// WBN Survivors 2 — PlayerCharacter (Implementierung).
#include "WBNPlayerCharacter.h"
#include "WBNCharAssembler.h"

AWBNPlayerCharacter::AWBNPlayerCharacter()
{
	Assembler = CreateDefaultSubobject<UWBNCharAssembler>(TEXT("CharAssembler"));
}

void AWBNPlayerCharacter::BeginPlay()
{
	Super::BeginPlay();
	if (CharacterData)
		Assembler->Assemble(CharacterData);
	else
		UE_LOG(LogTemp, Warning, TEXT("WBNPlayer: kein CharacterData gesetzt"));
}
