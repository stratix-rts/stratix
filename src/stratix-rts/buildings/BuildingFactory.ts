/**
 * BuildingFactory - 建筑工厂
 * 根据 BuildingConfig 创建 Building 实例
 */

import Phaser from 'phaser';

import { Building } from './Building';
import { BuildingConfig } from './types/BuildingType';

export class BuildingFactory {
  /**
   * 创建建筑实例
   * @param scene Phaser 场景
   * @param config 建筑配置
   * @returns Building 实例
   */
  public static create(scene: Phaser.Scene, config: BuildingConfig): Building {
    const building = new Building(scene, config);

    // 初始化格子间布局（默认 4 个空位）
    building.updateLayout(config.width, config.height, 2);

    building.growIn();

    return building;
  }
}
