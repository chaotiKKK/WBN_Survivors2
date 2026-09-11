// WBN Survivors 2 — Wellen-Regie (Implementierung, Spiegel von engine-run.js).
#include "WBNWaveDirector.h"
#include "Math/RandomStream.h"

TArray<FWBNSpawnGroup> UWBNWaveDirector::BuildWave(int32 Wave, float DangerCnt, int32 DangerLevel, bool bCoop, const TArray<FWBNEnemyPick>& Pool, int32 Seed)
{
	TArray<FWBNSpawnGroup> Out;
	const int32 N = FMath::Max(1, Wave);
	TArray<FWBNEnemyPick> Eligible;
	for (const FWBNEnemyPick& E : Pool)
		if (N >= E.MinWave) Eligible.Add(E);
	if (Eligible.Num() == 0) Eligible = Pool;
	if (Eligible.Num() == 0) return Out;

	FRandomStream Rng(Seed);
	const int32 GroupSize = FMath::Clamp(3 + N / 3, 3, 8);
	const int32 Budget = FMath::RoundToInt((20.f + N * 10.f + FMath::Pow((float)N, 1.7f)) * DangerCnt * (bCoop ? 1.5f : 1.f));
	const int32 NumGroups = FMath::Max(4, FMath::CeilToInt((float)Budget / (float)GroupSize));
	const float Interval = (WaveDuration - SpawnAnnounce) / (float)NumGroups;

	for (int32 g = 0; g < NumGroups; g++)
	{
		FWBNSpawnGroup Gr;
		Gr.Dir = g % 4;
		Gr.Time = SpawnAnnounce + g * Interval + Rng.FRandRange(0.f, 0.5f);
		for (int32 i = 0; i < GroupSize; i++)
		{
			float Total = 0.f;
			for (const FWBNEnemyPick& E : Eligible) Total += E.Weight * (1.f + (N - E.MinWave) * 0.05f);
			float Roll = Rng.FRandRange(0.f, Total);
			const FWBNEnemyPick* Pick = &Eligible.Last();
			for (const FWBNEnemyPick& E : Eligible)
			{
				Roll -= E.Weight * (1.f + (N - E.MinWave) * 0.05f);
				if (Roll <= 0.f) { Pick = &E; break; }
			}
			FWBNSpawnEntry En;
			En.EnemyId = Pick->EnemyId;
			En.bElite = (DangerLevel >= 2 && N >= 6 && Rng.FRand() < (0.04f + N * 0.004f));
			Gr.Entries.Add(En);
		}
		Out.Add(Gr);
	}
	return Out;
}
