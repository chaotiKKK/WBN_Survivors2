// Copyright Epic Games, Inc. All Rights Reserved.

using UnrealBuildTool;

public class WBN_Survivors2 : ModuleRules
{
	public WBN_Survivors2(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[] {
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",
			"AIModule",
			"NavigationSystem",
			"StateTreeModule",
			"GameplayStateTreeModule",
			"Niagara",
			"UMG",
			"Slate",
			"AssetRegistry"
		});

		PrivateDependencyModuleNames.AddRange(new string[] { "Json", "JsonUtilities" });

		PublicIncludePaths.AddRange(new string[] {
			"WBN_Survivors2",
			"WBN_Survivors2/Variant_Strategy",
			"WBN_Survivors2/Variant_Strategy/UI",
			"WBN_Survivors2/Variant_TwinStick",
			"WBN_Survivors2/Variant_TwinStick/AI",
			"WBN_Survivors2/Variant_TwinStick/Gameplay",
			"WBN_Survivors2/Variant_TwinStick/UI"
		});

		// Uncomment if you are using Slate UI
		// PrivateDependencyModuleNames.AddRange(new string[] { "Slate", "SlateCore" });

		// Uncomment if you are using online features
		// PrivateDependencyModuleNames.Add("OnlineSubsystem");

		// To include OnlineSubsystemSteam, add it to the plugins section in your uproject file with the Enabled attribute set to true
	}
}
