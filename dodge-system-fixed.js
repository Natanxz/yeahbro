import { system, world, Player, EntityDamageCause } from '@minecraft/server';

// Konfigurasi
const DODGE_TAG = "dodge";
const ADMIN_TAG = "admin";
const DODGE_SOUND = "random.orb";
const DODGE_COOLDOWN = 10 * 20; // 10 detik dalam ticks
const DEFAULT_MAX_DODGE = 3;
const DEFAULT_DODGE_CHANCE = 50;
const DEFAULT_DODGE_ANIMATION = "animation.humanoid.hurt";

// Key untuk dynamic properties
const MAX_DODGE_KEY = "dodge:max";
const CURRENT_DODGE_KEY = "dodge:current";
const DODGE_CHANCE_KEY = "dodge:chance";
const DODGE_ANIMATION_KEY = "dodge:animation";

// Debugging
const DEBUG = true;
function log(message) {
    if (DEBUG) console.log(`[Dodge System] ${message}`);
}

// Inisialisasi player
function initPlayer(player) {
    if (!player.hasTag(DODGE_TAG)) return;
    
    const maxDodge = player.getDynamicProperty(MAX_DODGE_KEY);
    if (maxDodge === undefined) {
        player.setDynamicProperty(MAX_DODGE_KEY, DEFAULT_MAX_DODGE);
    }
    
    const currentDodge = player.getDynamicProperty(CURRENT_DODGE_KEY);
    if (currentDodge === undefined) {
        player.setDynamicProperty(CURRENT_DODGE_KEY, player.getDynamicProperty(MAX_DODGE_KEY));
    } else if (maxDodge !== undefined && currentDodge > maxDodge) {
        // Pastikan current tidak melebihi max
        player.setDynamicProperty(CURRENT_DODGE_KEY, maxDodge);
    }
    
    if (player.getDynamicProperty(DODGE_CHANCE_KEY) === undefined) {
        player.setDynamicProperty(DODGE_CHANCE_KEY, DEFAULT_DODGE_CHANCE);
    }
    
    if (player.getDynamicProperty(DODGE_ANIMATION_KEY) === undefined) {
        player.setDynamicProperty(DODGE_ANIMATION_KEY, DEFAULT_DODGE_ANIMATION);
    }
}

// Sistem Dodge
let cooldown = DODGE_COOLDOWN;
const dodgingPlayers = new Map();

function refillDodge() {
    for (const player of world.getPlayers()) {
        if (!player.hasTag(DODGE_TAG)) continue;
        
        const max = player.getDynamicProperty(MAX_DODGE_KEY) || DEFAULT_MAX_DODGE;
        const current = player.getDynamicProperty(CURRENT_DODGE_KEY) || 0;
        
        if (current < max) {
            const newValue = current + 1;
            player.setDynamicProperty(CURRENT_DODGE_KEY, newValue);
            
            player.onScreenDisplay.setActionBar(`§b+1 Dodge §7(${newValue}/${max})`);
            player.playSound(DODGE_SOUND, { pitch: 0.8 });
            log(`Refilled dodge for ${player.name}: ${newValue}/${max}`);
        }
    }
}

// Mainkan animasi dodge
function playDodgeAnimation(player) {
    const animationName = player.getDynamicProperty(DODGE_ANIMATION_KEY) || DEFAULT_DODGE_ANIMATION;
    
    try {
        player.playAnimation(animationName);
        log(`Playing dodge animation for ${player.name}: ${animationName}`);
    } catch (e) {
        console.error(`Failed to play animation: ${e}`);
        player.playAnimation(DEFAULT_DODGE_ANIMATION);
    }
}

// PERBAIKAN UTAMA: Gunakan beforeEvents untuk mencegah damage sebelum terjadi
world.beforeEvents.entityHurt.subscribe(event => {
    const player = event.hurtEntity;
    if (!(player instanceof Player) || !player.hasTag(DODGE_TAG)) return;
    
    // Skip jika sedang dalam status dodge
    if (dodgingPlayers.has(player.id)) {
        event.cancel = true;
        log(`Damage canceled for ${player.name} (dodge active)`);
        return;
    }

    // Deteksi jenis damage
    const damageSource = event.damageSource;
    const isFallDamage = damageSource && damageSource.cause === EntityDamageCause.fall;
    
    // Skip fall damage (tidak bisa di-dodge)
    if (isFallDamage) {
        log(`Fall damage detected for ${player.name}, skipping dodge`);
        return;
    }

    const current = player.getDynamicProperty(CURRENT_DODGE_KEY) || 0;
    if (current <= 0) {
        log(`No dodges left for ${player.name}`);
        return;
    }

    const chance = player.getDynamicProperty(DODGE_CHANCE_KEY) || DEFAULT_DODGE_CHANCE;
    const roll = Math.random() * 100;
    
    if (roll > chance) {
        log(`Dodge failed for ${player.name} (${roll.toFixed(2)} > ${chance})`);
        return;
    }

    // Dodge berhasil - BATALKAN EVENT SEBELUM DAMAGE TERJADI
    event.cancel = true;
    
    const newValue = current - 1;
    player.setDynamicProperty(CURRENT_DODGE_KEY, newValue);
    
    // Tampilkan efek visual dan suara
    const max = player.getDynamicProperty(MAX_DODGE_KEY) || DEFAULT_MAX_DODGE;
    player.onScreenDisplay.setActionBar(`§aDodge! §7(${newValue}/${max})`);
    player.playSound(DODGE_SOUND);
    
    // Spawn particle effect
    system.runTimeout(() => {
        if (player.isValid()) {
            try {
                player.dimension.spawnParticle("minecraft:crystal_spark_particle", player.location);
            } catch (e) {
                console.error(`Failed to spawn particles: ${e}`);
            }
        }
    }, 1);
    
    log(`Successful dodge for ${player.name}! Remaining: ${newValue}/${max}`);
    
    // Mainkan animasi dodge
    system.runTimeout(() => {
        if (player.isValid()) {
            playDodgeAnimation(player);
        }
    }, 1);
    
    // Beri efek invulnerability singkat untuk mencegah multiple damage dalam frame yang sama
    dodgingPlayers.set(player.id, system.runTimeout(() => {
        dodgingPlayers.delete(player.id);
        log(`Invulnerability ended for ${player.name}`);
    }, 5)); // 5 ticks invulnerability
});

// TAMBAHAN: Backup system menggunakan afterEvents untuk kasus edge case
world.afterEvents.entityHurt.subscribe(event => {
    const player = event.hurtEntity;
    if (!(player instanceof Player) || !player.hasTag(DODGE_TAG)) return;
    
    // Jika player dalam status dodge tapi masih kena damage (edge case)
    if (dodgingPlayers.has(player.id)) {
        log(`Edge case: Player ${player.name} took damage while dodging, healing back`);
        
        // Heal player kembali
        const damage = event.damage;
        system.runTimeout(() => {
            if (player.isValid()) {
                try {
                    const health = player.getComponent("minecraft:health");
                    if (health) {
                        const currentHealth = health.currentValue;
                        const maxHealth = health.effectiveMax;
                        const newHealth = Math.min(currentHealth + damage, maxHealth);
                        health.setCurrentValue(newHealth);
                        log(`Healed ${player.name} back by ${damage} HP`);
                    }
                } catch (e) {
                    console.error(`Failed to heal player: ${e}`);
                }
            }
        }, 1);
        
        // Reset knockback
        system.runTimeout(() => {
            if (player.isValid()) {
                try {
                    player.applyKnockback(0, 0, 0, 0);
                    player.clearVelocity();
                    log(`Reset knockback for ${player.name}`);
                } catch (e) {
                    console.error(`Failed to reset knockback: ${e}`);
                }
            }
        }, 1);
    }
});

// =====================================
// ADMIN COMMAND HANDLER - IMPROVED
// =====================================

// Fungsi untuk menghitung jarak kuadrat
function distanceSquared(pos1, pos2) {
    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    const dz = pos1.z - pos2.z;
    return dx*dx + dy*dy + dz*dz;
}

// Cari player terdekat
function findNearestPlayer(admin) {
    const adminLoc = admin.location;
    let nearest = null;
    let minDistSq = Number.MAX_VALUE;

    for (const player of world.getPlayers()) {
        if (player.id === admin.id) continue; // Skip admin
        
        const distSq = distanceSquared(adminLoc, player.location);
        if (distSq < minDistSq) {
            minDistSq = distSq;
            nearest = player;
        }
    }

    return nearest;
}

// Dapatkan target berdasarkan selector
function getTargets(admin, selector) {
    if (selector === "@a") {
        return world.getPlayers();
    } else if (selector === "@s") {
        return [admin];
    } else if (selector === "@p") {
        const target = findNearestPlayer(admin);
        return target ? [target] : [];
    } else {
        // Cari berdasarkan nama atau ID
        for (const player of world.getPlayers()) {
            if (player.name.toLowerCase() === selector.toLowerCase() || 
                player.id === selector) {
                return [player];
            }
        }
        return [];
    }
}

// Tampilkan status player
function showStatus(admin, player) {
    const max = player.getDynamicProperty(MAX_DODGE_KEY) || DEFAULT_MAX_DODGE;
    const current = player.getDynamicProperty(CURRENT_DODGE_KEY) || max;
    const chance = player.getDynamicProperty(DODGE_CHANCE_KEY) || DEFAULT_DODGE_CHANCE;
    const animation = player.getDynamicProperty(DODGE_ANIMATION_KEY) || DEFAULT_DODGE_ANIMATION;
    const hasTag = player.hasTag(DODGE_TAG);

    admin.sendMessage(`§6[ Dodge Status - ${player.name} ]`);
    admin.sendMessage(`§fMax Dodge: §a${max}`);
    admin.sendMessage(`§fCurrent Dodge: §a${current}`);
    admin.sendMessage(`§fDodge Chance: §a${chance}%`);
    admin.sendMessage(`§fDodge Animation: §a${animation}`);
    admin.sendMessage(`§fTag Active: §a${hasTag ? "Yes" : "No"}`);
}

// Reset player ke default
function resetPlayer(player) {
    player.setDynamicProperty(MAX_DODGE_KEY, DEFAULT_MAX_DODGE);
    player.setDynamicProperty(CURRENT_DODGE_KEY, DEFAULT_MAX_DODGE);
    player.setDynamicProperty(DODGE_CHANCE_KEY, DEFAULT_DODGE_CHANCE);
    player.setDynamicProperty(DODGE_ANIMATION_KEY, DEFAULT_DODGE_ANIMATION);
}

// Toggle dodge tag
function toggleDodgeTag(player) {
    if (player.hasTag(DODGE_TAG)) {
        player.removeTag(DODGE_TAG);
    } else {
        player.addTag(DODGE_TAG);
        initPlayer(player);
    }
}

// Tampilkan bantuan perintah
function showHelp(admin) {
    admin.sendMessage("§6[ Dodge Admin Commands ]");
    admin.sendMessage("§f!dodgeadmin chance <target> <value> §7- Set dodge chance (0-100)");
    admin.sendMessage("§f!dodgeadmin max <target> <value> §7- Set max dodge");
    admin.sendMessage("§f!dodgeadmin current <target> <value> §7- Set current dodge");
    admin.sendMessage("§f!dodgeadmin animation <target> <value> §7- Set dodge animation");
    admin.sendMessage("§f!dodgeadmin status <target> §7- Show player status");
    admin.sendMessage("§f!dodgeadmin reset <target> §7- Reset to defaults");
    admin.sendMessage("§f!dodgeadmin toggle <target> §7- Toggle dodge ability");
    admin.sendMessage("§eTargets: §a@a §7(all), §a@s §7(self), §a@p §7(nearest), §aname/id");
}

// Fungsi penanganan perintah admin
function handleAdminCommand(admin, args) {
    if (args.length === 0) {
        showHelp(admin);
        return false;
    }

    const command = args[0];
    const validCommands = ["chance", "max", "current", "animation", "status", "reset", "toggle"];

    if (!validCommands.includes(command)) {
        admin.sendMessage("§cInvalid command. Valid commands: " + validCommands.join(", "));
        return false;
    }

    // Handle status/reset/toggle commands
    if (["status", "reset", "toggle"].includes(command)) {
        if (args.length < 2) {
            admin.sendMessage(`§cFormat: !dodgeadmin ${command} <target>`);
            return false;
        }

        const targets = getTargets(admin, args[1]);
        if (targets.length === 0) {
            admin.sendMessage("§cTarget not found!");
            return false;
        }

        for (const target of targets) {
            switch(command) {
                case "status":
                    showStatus(admin, target);
                    break;
                case "reset":
                    resetPlayer(target);
                    admin.sendMessage(`§aReset settings for §e${target.name}§a to default`);
                    break;
                case "toggle":
                    toggleDodgeTag(target);
                    admin.sendMessage(`§aToggled dodge tag for §e${target.name}§a. New status: §e${target.hasTag(DODGE_TAG) ? "ENABLED" : "DISABLED"}`);
                    break;
            }
        }
        return true;
    }

    // Handle other commands (chance/max/current/animation)
    if (args.length < 3) {
        admin.sendMessage(`§cFormat: !dodgeadmin ${command} <target> <value>`);
        return false;
    }

    const targets = getTargets(admin, args[1]);
    if (targets.length === 0) {
        admin.sendMessage("§cTarget not found!");
        return false;
    }

    const value = args.slice(2).join(" ");
    let success = false;

    for (const target of targets) {
        try {
            switch(command) {
                case "chance":
                    const chanceValue = parseInt(value);
                    if (!isNaN(chanceValue) && chanceValue >= 0 && chanceValue <= 100) {
                        target.setDynamicProperty(DODGE_CHANCE_KEY, chanceValue);
                        admin.sendMessage(`§aSet dodge chance for §e${target.name}§a to §e${chanceValue}%`);
                        success = true;
                    } else {
                        admin.sendMessage("§cChance must be 0-100!");
                    }
                    break;
                    
                case "max":
                    const maxValue = parseInt(value);
                    if (!isNaN(maxValue) && maxValue >= 1) {
                        target.setDynamicProperty(MAX_DODGE_KEY, maxValue);
                        
                        // Adjust current dodge if needed
                        const current = target.getDynamicProperty(CURRENT_DODGE_KEY) || 0;
                        if (current > maxValue) {
                            target.setDynamicProperty(CURRENT_DODGE_KEY, maxValue);
                        }
                        
                        admin.sendMessage(`§aSet max dodge for §e${target.name}§a to §e${maxValue}`);
                        success = true;
                    } else {
                        admin.sendMessage("§cValue must be a positive number!");
                    }
                    break;
                    
                case "current":
                    const currentValue = parseInt(value);
                    if (!isNaN(currentValue) && currentValue >= 0) {
                        const max = target.getDynamicProperty(MAX_DODGE_KEY) || DEFAULT_MAX_DODGE;
                        const newValue = Math.min(currentValue, max);
                        target.setDynamicProperty(CURRENT_DODGE_KEY, newValue);
                        admin.sendMessage(`§aSet current dodge for §e${target.name}§a to §e${newValue}`);
                        success = true;
                    } else {
                        admin.sendMessage("§cValue must be a positive number!");
                    }
                    break;
                    
                case "animation":
                    target.setDynamicProperty(DODGE_ANIMATION_KEY, value);
                    admin.sendMessage(`§aSet dodge animation for §e${target.name}§a to §e${value}`);
                    success = true;
                    break;
            }
        } catch (e) {
            console.error(`Error executing command for ${target.name}: ${e}`);
            admin.sendMessage("§cError executing command!");
        }
    }
    
    return success;
}

// =====================================
// INISIALISASI SISTEM - IMPROVED
// =====================================
system.run(() => {
    log("System starting...");
    
    // Inisialisasi player yang sudah ada
    for (const player of world.getPlayers()) {
        initPlayer(player);
    }
    
    // Setup cooldown interval
    system.runInterval(() => {
        if (--cooldown <= 0) {
            log("Refilling dodges...");
            refillDodge();
            cooldown = DODGE_COOLDOWN;
        }
    }, 1);
    
    // Handle player baru melalui interval
    system.runInterval(() => {
        for (const player of world.getPlayers()) {
            if (player.hasTag(DODGE_TAG) && player.getDynamicProperty(MAX_DODGE_KEY) === undefined) {
                initPlayer(player);
            }
        }
    }, 100);
    
    // Handle new players
    world.afterEvents.playerSpawn.subscribe(event => {
        if (event.initialSpawn) {
            const player = event.player;
            if (player.hasTag(DODGE_TAG)) {
                initPlayer(player);
            }
        }
    });
    
    log("Dodge System initialized!");
});

// Handle chat commands
world.beforeEvents.chatSend.subscribe(event => {
    const player = event.sender;
    const message = event.message;
    
    if (!message.startsWith("!dodgeadmin")) return;
    event.cancel = true;
    
    // Periksa apakah player memiliki tag admin
    if (!player.hasTag(ADMIN_TAG)) {
        player.sendMessage("§cYou need admin tag to use this command!");
        return;
    }

    // Pisahkan argumen
    const args = message.split(' ').slice(1);
    
    // Jalankan perintah admin
    handleAdminCommand(player, args);
});