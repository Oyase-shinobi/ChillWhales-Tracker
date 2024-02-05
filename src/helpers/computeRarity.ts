import { readFileContent, writeFileContent } from '../utils';
import { Asset, AssetConfig, RarityLookup, TraitFrequency } from '../@types';
import { fetchAssetsForRanking } from '../requests/universalpage';

interface RarityScore {
    id: string;
    score: number;
    rank?: number;
}

function addTraitCountAsTrait(nfts: Asset[]): void {
    nfts.forEach(nft => {
        const traitCount = Object.keys(nft.tokenAttributes).length;
        nft.tokenAttributes.push({ key: 'TraitCount', type: 'NUMBER', value: traitCount.toString() }); // Add TraitCount as an artificial trait
    });
}

function calculateTraitFrequencies(nfts: Asset[]): TraitFrequency {
    const frequencies: TraitFrequency = {};
    nfts.forEach(nft => {
        nft.tokenAttributes.forEach(({ key, value }) => {
            if (!frequencies[key]) {
                frequencies[key] = {};
            }
            if (!frequencies[key][value]) {
                frequencies[key][value] = 1;
            } else {
                frequencies[key][value]++;
            }
        });
    });
    return frequencies;
}

function calculateRarityScore(nft: Asset, frequencies: TraitFrequency): number {
    return nft.tokenAttributes.reduce((acc, { key, value }) => {
        const frequency = frequencies[key][value];
        const rarity = 1 / frequency;
        return acc + rarity;
    }, 0);
}

function assignUniqueRanks(rarityScores: RarityScore[]): RarityScore[] {
    rarityScores.sort((a, b) => b.score - a.score);
    rarityScores.forEach((item, index) => {
        item.rank = index + 1; // Ensures each item gets a unique rank
    });
    return rarityScores;
}

async function fetchAllAssets(assetContract: string, amount: number): Promise<Asset[]> {
    let allAssets: Asset[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
        const assets = await fetchAssetsForRanking(assetContract, amount, page);
        if (assets.length > 0) {
            allAssets = allAssets.concat(assets);
            page += 1; // Increase the page number for the next iteration
        } else {
            hasMore = false; // No more assets returned, stop the loop
        }
    }

    return allAssets;
}

export async function getCollectionRanking(assetConfig: AssetConfig): Promise<RarityLookup> {
    const scores = JSON.parse(readFileContent('cache', `${assetConfig.collection}Scores.json`)) as RarityLookup;
    if (scores.rarity) {
        return scores;
    } else {
        return await calculateRarity(assetConfig);
    }
}

async function calculateRarity(assetConfig: AssetConfig): Promise<RarityLookup> {
    const contract = assetConfig.assetContract;
    const collection = await fetchAllAssets(contract, 100);

    addTraitCountAsTrait(collection);
    const frequencies = calculateTraitFrequencies(collection);
    const rarityScores = collection.map(asset => ({
        id: asset.tokenId,
        score: calculateRarityScore(asset, frequencies)
    }));

    const rankedNFTs = assignUniqueRanks(rarityScores);
    const mapped: Record<string, { score: number; rank: number }> = {};
    for (const ranked of rankedNFTs) {
        mapped[ranked.id] = {
            score: ranked.score,
            rank: ranked.rank
        };
    }
    const prepareFile: RarityLookup = {
        rarity: mapped,
        traitFrequencies: frequencies,
        assetsTotal: collection.length
    };

    writeFileContent('cache', `${assetConfig.collection}Scores.json`, JSON.stringify(prepareFile, null, 2));
    return prepareFile;
}
